import express from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";
import { claimIdempotencyKey, completeIdempotencyKey } from "./idempotency";

export const purchaseCreditsRouter = express.Router();
const allocationSchema=z.object({billId:z.string().uuid(),allocationDate:z.string().date(),amount:z.coerce.number().positive().max(999999999999),reason:z.string().trim().min(5).max(500)});
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;

purchaseCreditsRouter.get("/credits",requireAuth,requirePermission("purchases.view"),async(req,res,next)=>{
  try {
    const [q,permission]=await Promise.all([pool.query(`SELECT r.id,r.return_number AS "returnNumber",r.return_date::text AS "returnDate",r.supplier_id AS "supplierId",s.name AS "supplierName",r.total::numeric(14,2) total,COALESCE(SUM(a.amount),0)::numeric(14,2) AS "amountApplied",COALESCE((SELECT SUM(f.amount) FROM purchase_return_refunds f WHERE f.company_id=r.company_id AND f.purchase_return_id=r.id),0)::numeric(14,2) AS "amountRefunded",GREATEST(r.total-COALESCE(SUM(a.amount),0)-COALESCE((SELECT SUM(f.amount) FROM purchase_return_refunds f WHERE f.company_id=r.company_id AND f.purchase_return_id=r.id),0),0)::numeric(14,2) AS available FROM purchase_returns r JOIN business_partners s ON s.company_id=r.company_id AND s.id=r.supplier_id LEFT JOIN purchase_return_allocations a ON a.company_id=r.company_id AND a.purchase_return_id=r.id WHERE r.company_id=$1 AND ($2::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id=$2) GROUP BY r.id,s.id,s.name HAVING r.total-COALESCE(SUM(a.amount),0)-COALESCE((SELECT SUM(f.amount) FROM purchase_return_refunds f WHERE f.company_id=r.company_id AND f.purchase_return_id=r.id),0)>.009 ORDER BY r.return_date,r.return_number`,[req.auth!.companyId,req.auth!.branchId]),pool.query(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND p.code='purchases.credit.refund') AS "canRefund"`,[req.auth!.companyId,req.auth!.userId])]);
    res.json({credits:q.rows,canRefund:permission.rows[0].canRefund});
  } catch(e) { next(e); }
});

purchaseCreditsRouter.get("/credits/:id/bills",requireAuth,requirePermission("purchases.view"),async(req,res,next)=>{
  const id=z.string().uuid().safeParse(req.params.id);
  if(!id.success)return res.status(404).json({error:{code:"SUPPLIER_CREDIT_NOT_FOUND",message:"Supplier credit was not found."}});
  try {
    const q=await pool.query(`SELECT b.id,b.bill_number AS "billNumber",b.bill_date::text AS "billDate",b.total::numeric(14,2) total,GREATEST(b.total-COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.company_id=b.company_id AND p.bill_id=b.id),0)-COALESCE((SELECT SUM(a.amount) FROM purchase_return_allocations a WHERE a.company_id=b.company_id AND a.bill_id=b.id),0),0)::numeric(14,2) AS outstanding FROM purchase_returns r JOIN purchase_bills b ON b.company_id=r.company_id AND b.supplier_id=r.supplier_id WHERE r.company_id=$1 AND r.id=$2 AND ($3::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id=$3) AND ($3::uuid IS NULL OR b.branch_id IS NULL OR b.branch_id=$3) AND b.id<>r.bill_id AND b.total-COALESCE((SELECT SUM(p.amount) FROM supplier_payments p WHERE p.company_id=b.company_id AND p.bill_id=b.id),0)-COALESCE((SELECT SUM(a.amount) FROM purchase_return_allocations a WHERE a.company_id=b.company_id AND a.bill_id=b.id),0)>.009 ORDER BY b.bill_date,b.bill_number`,[req.auth!.companyId,id.data,req.auth!.branchId]);
    res.json({bills:q.rows});
  } catch(e) { next(e); }
});

purchaseCreditsRouter.post("/credits/:id/allocations",requireAuth,requirePermission("purchases.credit.apply"),async(req,res,next)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=allocationSchema.safeParse(req.body);
  if(!id.success)return res.status(404).json({error:{code:"SUPPLIER_CREDIT_NOT_FOUND",message:"Supplier credit was not found."}});
  if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Choose a bill, allocation date, amount and reason."}});
  const x=parsed.data,cid=req.auth!.companyId,actor=req.auth!.userId,requestKey=(req.get("Idempotency-Key")??"").trim(),operation="purchases.credit.apply:"+id.data,client=await pool.connect();
  try {
    await client.query("BEGIN");
    const claim=await claimIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,body:{returnId:id.data,...x}});
    if(claim.replay){await client.query("COMMIT");return res.status(claim.status).json(claim.body);}
    const creditRef=await client.query<{bill_id:string;branch_id:string|null}>("SELECT bill_id,branch_id FROM purchase_returns WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3)",[cid,id.data,req.auth!.branchId]);
    if(!creditRef.rowCount)throw Object.assign(new Error("Supplier credit was not found."),{httpStatus:404});
    await client.query("SELECT id FROM purchase_bills WHERE company_id=$1 AND id=$2 FOR UPDATE",[cid,x.billId]);
    const credit=await client.query<{supplier_id:string;total:string;return_number:string;branch_id:string|null}>("SELECT supplier_id,total::text,return_number,branch_id FROM purchase_returns WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3) FOR UPDATE",[cid,id.data,req.auth!.branchId]);
    const bill=await client.query<{supplier_id:string;bill_number:string;total:string;branch_id:string|null}>("SELECT supplier_id,bill_number,total::text,branch_id FROM purchase_bills WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3) FOR UPDATE",[cid,x.billId,req.auth!.branchId]);
    if(!bill.rowCount||bill.rows[0].supplier_id!==credit.rows[0].supplier_id||(credit.rows[0].branch_id!==null&&bill.rows[0].branch_id!==null&&credit.rows[0].branch_id!==bill.rows[0].branch_id))throw Object.assign(new Error("Choose a bill for the same supplier and branch."),{httpStatus:400});
    if(x.billId===creditRef.rows[0].bill_id)throw Object.assign(new Error("Unused supplier credits can be applied to another open bill only."),{httpStatus:400});
    const [creditUsed,paid,billCredits]=await Promise.all([
      client.query<{amount:string}>("SELECT COALESCE(SUM(amount),0)::text amount FROM purchase_return_allocations WHERE company_id=$1 AND purchase_return_id=$2",[cid,id.data]),
      client.query<{amount:string}>("SELECT COALESCE(SUM(amount),0)::text amount FROM supplier_payments WHERE company_id=$1 AND bill_id=$2",[cid,x.billId]),
      client.query<{amount:string}>("SELECT COALESCE(SUM(amount),0)::text amount FROM purchase_return_allocations WHERE company_id=$1 AND bill_id=$2",[cid,x.billId]),
    ]);
    const creditAvailable=cents(Number(credit.rows[0].total)-Number(creditUsed.rows[0].amount)),billOutstanding=cents(Number(bill.rows[0].total)-Number(paid.rows[0].amount)-Number(billCredits.rows[0].amount));
    if(x.amount>creditAvailable+.001)throw Object.assign(new Error("Allocation exceeds the unused supplier credit."),{httpStatus:409,errorCode:"SUPPLIER_CREDIT_EXCEEDED"});
    if(x.amount>billOutstanding+.001)throw Object.assign(new Error("Allocation exceeds the bill's outstanding balance."),{httpStatus:409,errorCode:"BILL_CREDIT_EXCEEDED"});
    const saved=await client.query<{id:string}>("INSERT INTO purchase_return_allocations(company_id,purchase_return_id,bill_id,supplier_id,amount,allocation_date,reason,created_by,branch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[cid,id.data,x.billId,credit.rows[0].supplier_id,x.amount,x.allocationDate,x.reason,actor,credit.rows[0].branch_id]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,reason,after_data) VALUES($1,$2,'purchases.credit.allocate','purchase_return_allocation',$3,$4,$5::jsonb)",[cid,actor,saved.rows[0].id,x.reason,JSON.stringify({returnId:id.data,returnNumber:credit.rows[0].return_number,billId:x.billId,billNumber:bill.rows[0].bill_number,amount:x.amount,allocationDate:x.allocationDate,creditAvailableBefore:creditAvailable,billOutstandingBefore:billOutstanding})]);
    const response={id:saved.rows[0].id,amount:x.amount,creditAvailable:cents(creditAvailable-x.amount),billOutstanding:cents(billOutstanding-x.amount)};
    await completeIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,status:201,body:response});
    await client.query("COMMIT");
    res.status(201).json(response);
  } catch(e) {
    await client.query("ROLLBACK").catch(()=>undefined);
    const status=(e as {httpStatus?:number}).httpStatus;
    if(status)return res.status(status).json({error:{code:(e as {errorCode?:string}).errorCode??"SUPPLIER_CREDIT_INVALID",message:(e as Error).message}});
    next(e);
  } finally { client.release(); }
});
