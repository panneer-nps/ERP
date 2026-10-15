import express from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";

export const notificationsRouter=express.Router();
notificationsRouter.use(requireAuth);
const preferenceSchema=z.object({sales_invoice:z.boolean(),payment_received:z.boolean(),expense_approval:z.boolean(),employee_advance:z.boolean(),broker_commission_pending:z.boolean(),approval_request:z.boolean(),loading_started:z.boolean(),loading_completed:z.boolean(),loading_verified:z.boolean(),loading_mismatch:z.boolean(),delivery_dispatched:z.boolean(),delivery_completed:z.boolean(),production_completed:z.boolean(),low_stock:z.boolean()}).strict();
const defaultPreferences={sales_invoice:true,payment_received:true,expense_approval:true,employee_advance:true,broker_commission_pending:true,approval_request:true,loading_started:true,loading_completed:true,loading_verified:true,loading_mismatch:true,delivery_dispatched:true,delivery_completed:true,production_completed:true,low_stock:true};
async function isOwner(companyId:string,userId:string){const result=await pool.query<{owner:boolean}>(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND r.code='owner') owner`,[companyId,userId]);return result.rows[0]?.owner===true;}

notificationsRouter.post("/sync-low-stock",requirePermission("stock.view"),async(req,res,next)=>{
  const companyId=req.auth!.companyId,branchId=req.auth!.branchId,actorId=req.auth!.userId;
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`low-stock-alert:${companyId}:${branchId??"all"}`]);
    const transitioned=await client.query<{product_id:string}>(`WITH available AS (
      SELECT sm.product_id,SUM(CASE WHEN sm.direction='in' THEN sm.quantity ELSE -sm.quantity END)::numeric(14,2) quantity
      FROM stock_movements sm JOIN stock_locations l ON l.company_id=sm.company_id AND l.id=sm.location_id
      WHERE sm.company_id=$1 AND l.active=true AND sm.quality IN ('good','second')
        AND ($2::uuid IS NULL OR l.branch_id IS NULL OR l.branch_id=$2)
      GROUP BY sm.product_id
    ), low_products AS (
      SELECT p.id,p.name,p.unit,p.minimum_stock,COALESCE(a.quantity,0)::numeric(14,2) quantity
      FROM products p LEFT JOIN available a ON a.product_id=p.id
      WHERE p.company_id=$1 AND p.active=true AND p.minimum_stock>0 AND COALESCE(a.quantity,0)<p.minimum_stock
    ), released AS (
      UPDATE low_stock_alert_state s SET active=false,updated_at=now()
      WHERE s.company_id=$1 AND s.branch_id IS NOT DISTINCT FROM $2::uuid AND s.active=true
        AND NOT EXISTS(SELECT 1 FROM low_products lp WHERE lp.id=s.product_id)
      RETURNING s.product_id
    ), activated AS (
      INSERT INTO low_stock_alert_state(company_id,branch_id,product_id,active,updated_at)
      SELECT $1,$2,lp.id,true,now() FROM low_products lp
      ON CONFLICT(company_id,branch_id,product_id) DO UPDATE SET active=true,updated_at=now()
      WHERE low_stock_alert_state.active=false
      RETURNING product_id
    ), emitted AS (
      INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,after_data)
      SELECT $1,$2,$3,'inventory.low_stock.alert','product',lp.id::text,
        jsonb_build_object('productName',lp.name,'unit',lp.unit,'available',lp.quantity,'minimum',lp.minimum_stock)
      FROM activated a JOIN low_products lp ON lp.id=a.product_id
      RETURNING entity_id
    ) SELECT entity_id AS product_id FROM emitted`,[companyId,branchId,actorId]);
    await client.query("COMMIT");
    return res.json({success:true,newAlerts:transitioned.rows.length});
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);return next(error);}finally{client.release();}
});

notificationsRouter.get("/",async(req,res,next)=>{
  try{
    const result=await pool.query(`SELECT n.id,n.event_type AS "eventType",n.title_en AS "titleEn",n.title_ta AS "titleTa",n.body_en AS "bodyEn",n.body_ta AS "bodyTa",n.href,n.entity_type AS "entityType",n.entity_id AS "entityId",n.created_at AS "createdAt",n.read_at AS "readAt",(SELECT count(*)::int FROM user_notifications u WHERE u.company_id=$1 AND u.recipient_user_id=$2 AND u.read_at IS NULL AND ($3::uuid IS NULL OR u.branch_id IS NULL OR u.branch_id=$3)) AS "unreadCount" FROM user_notifications n WHERE n.company_id=$1 AND n.recipient_user_id=$2 AND ($3::uuid IS NULL OR n.branch_id IS NULL OR n.branch_id=$3) ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,[req.auth!.companyId,req.auth!.userId,req.auth!.branchId]);
    const [owner,preferenceRow]=await Promise.all([isOwner(req.auth!.companyId,req.auth!.userId),pool.query<{value:Record<string,boolean>}>(`SELECT value FROM company_settings WHERE company_id=$1 AND key='notification_preferences'`,[req.auth!.companyId])]);
    res.setHeader("Cache-Control","no-store");
    return res.json({notifications:result.rows,unreadCount:result.rows[0]?.unreadCount??0,limit:100,canManagePreferences:owner,preferences:{...defaultPreferences,...(preferenceRow.rows[0]?.value??{})}});
  }catch(error){return next(error);}
});

notificationsRouter.put("/preferences",async(req,res,next)=>{
  const parsed=preferenceSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{code:"INVALID_NOTIFICATION_PREFERENCES",message:"Choose on or off for each notification type."}});
  const companyId=req.auth!.companyId,userId=req.auth!.userId;
  const client=await pool.connect();
  try{
    if(!await isOwner(companyId,userId))return res.status(403).json({error:{code:"OWNER_REQUIRED",message:"Only an Owner can change notification preferences."}});
    await client.query("BEGIN");
    await client.query(`INSERT INTO company_settings(company_id,key,value,updated_by) VALUES($1,'notification_preferences',$2::jsonb,$3) ON CONFLICT(company_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`,[companyId,JSON.stringify(parsed.data),userId]);
    await client.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,after_data) VALUES($1,$2,'notifications.preferences.update','company_settings',$3::jsonb)`,[companyId,userId,JSON.stringify(parsed.data)]);
    await client.query("COMMIT");
    return res.json({success:true,preferences:parsed.data});
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);return next(error);}finally{client.release();}
});

notificationsRouter.post("/read-all",async(req,res,next)=>{
  try{
    const result=await pool.query(`UPDATE user_notifications SET read_at=now() WHERE company_id=$1 AND recipient_user_id=$2 AND read_at IS NULL AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3)`,[req.auth!.companyId,req.auth!.userId,req.auth!.branchId]);
    return res.json({success:true,updated:result.rowCount??0});
  }catch(error){return next(error);}
});

notificationsRouter.post("/:id/read",async(req,res,next)=>{
  const parsed=z.string().uuid().safeParse(req.params.id);
  if(!parsed.success)return res.status(404).json({error:{code:"NOTIFICATION_NOT_FOUND",message:"Notification was not found."}});
  try{
    const result=await pool.query(`UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND company_id=$2 AND recipient_user_id=$3 AND ($4::uuid IS NULL OR branch_id IS NULL OR branch_id=$4) RETURNING id`,[parsed.data,req.auth!.companyId,req.auth!.userId,req.auth!.branchId]);
    if(!result.rowCount)return res.status(404).json({error:{code:"NOTIFICATION_NOT_FOUND",message:"Notification was not found."}});
    return res.json({success:true});
  }catch(error){return next(error);}
});
