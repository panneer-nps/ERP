import express from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";

export const productTaxCodesRouter=express.Router();
const codeSchema=z.object({code:z.string().trim().toUpperCase().min(1).max(24).regex(/^[A-Z0-9_-]+$/),hsnCode:z.string().trim().max(16).default(""),description:z.string().trim().min(2).max(160),salesTaxRate:z.coerce.number().min(0).max(100),purchaseTaxRate:z.coerce.number().min(0).max(100)});

productTaxCodesRouter.get("/tax-codes",requireAuth,requirePermission("masters.view"),async(req,res,next)=>{
  try{const q=await pool.query(`SELECT id,code,hsn_code AS "hsnCode",description,sales_tax_rate AS "salesTaxRate",purchase_tax_rate AS "purchaseTaxRate",active,EXISTS(SELECT 1 FROM products p WHERE p.company_id=t.company_id AND p.tax_code_id=t.id) AS "inUse" FROM product_tax_codes t WHERE company_id=$1 ORDER BY active DESC,lower(code)`,[req.auth!.companyId]);res.json({records:q.rows});}catch(e){next(e);}
});

productTaxCodesRouter.post("/tax-codes",requireAuth,requirePermission("products.tax.configure"),async(req,res,next)=>{
  const p=codeSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:{code:"TAX_CODE_INVALID",message:"Enter a code, description, HSN/SAC and valid sales and purchase tax rates."}});
  const x=p.data,cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();
  try{await client.query("BEGIN");const saved=await client.query<{id:string}>("INSERT INTO product_tax_codes(company_id,code,hsn_code,description,sales_tax_rate,purchase_tax_rate,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[cid,x.code,x.hsnCode,x.description,x.salesTaxRate,x.purchaseTaxRate,actor]);await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'product.tax_code.create','product_tax_code',$3,$4::jsonb)",[cid,actor,saved.rows[0].id,JSON.stringify(x)]);await client.query("COMMIT");res.status(201).json({id:saved.rows[0].id});}
  catch(e){await client.query("ROLLBACK").catch(()=>undefined);if((e as {code?:string}).code==="23505")return res.status(409).json({error:{code:"TAX_CODE_DUPLICATE",message:"That tax code already exists."}});next(e);}finally{client.release();}
});

productTaxCodesRouter.patch("/tax-codes/:id/active",requireAuth,requirePermission("products.tax.configure"),async(req,res,next)=>{
  const id=z.string().uuid().safeParse(req.params.id),p=z.object({active:z.boolean()}).safeParse(req.body);if(!id.success)return res.status(404).json({error:{code:"TAX_CODE_NOT_FOUND",message:"Tax code was not found."}});if(!p.success)return res.status(400).json({error:{code:"TAX_CODE_STATUS_INVALID",message:"Choose active or inactive."}});
  const client=await pool.connect();try{await client.query("BEGIN");const row=await client.query<{active:boolean;code:string}>("SELECT active,code FROM product_tax_codes WHERE company_id=$1 AND id=$2 FOR UPDATE",[req.auth!.companyId,id.data]);if(!row.rowCount)throw Object.assign(new Error("Tax code was not found."),{httpStatus:404});await client.query("UPDATE product_tax_codes SET active=$3,updated_at=now() WHERE company_id=$1 AND id=$2",[req.auth!.companyId,id.data,p.data.active]);await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'product.tax_code.status','product_tax_code',$3,$4::jsonb,$5::jsonb)",[req.auth!.companyId,req.auth!.userId,id.data,JSON.stringify({active:row.rows[0].active,code:row.rows[0].code}),JSON.stringify({active:p.data.active})]);await client.query("COMMIT");res.json({success:true,active:p.data.active});}
  catch(e){await client.query("ROLLBACK").catch(()=>undefined);const status=(e as {httpStatus?:number}).httpStatus;if(status)return res.status(status).json({error:{code:"TAX_CODE_NOT_FOUND",message:(e as Error).message}});next(e);}finally{client.release();}
});
