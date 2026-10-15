import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { requireAuth, requirePermission } from "./auth";
import { pool } from "./db";
import { claimIdempotencyKey, completeIdempotencyKey } from "./idempotency";
import { enforceApprovalLimit } from "./approval-limits";

type JournalLine = { accountCode: string; description: string; debit: number; credit: number };
type PostJournal = (client: PoolClient, args: { companyId: string; actorId: string; sourceType: string; sourceId: string; description: string; effectiveDate: string; branchId: string | null; lines: JournalLine[] }) => Promise<string>;
const requestSchema = z.object({
  effectiveDate: z.string().date(), description: z.string().trim().min(3).max(240), reason: z.string().trim().min(5).max(500),
  lines: z.array(z.object({ accountId: z.string().uuid(), description: z.string().trim().min(2).max(240), debit: z.coerce.number().min(0).max(999999999999), credit: z.coerce.number().min(0).max(999999999999) })).min(2).max(50),
}).superRefine((x,ctx)=>{
  let debit=0,credit=0;
  x.lines.forEach((line,i)=>{const d=Math.round(line.debit*100),c=Math.round(line.credit*100);if((d>0)===(c>0))ctx.addIssue({code:z.ZodIssueCode.custom,path:["lines",i],message:"Each line needs either a debit or a credit."});debit+=d;credit+=c;});
  if(debit<=0||debit!==credit)ctx.addIssue({code:z.ZodIssueCode.custom,path:["lines"],message:"Total debits must equal total credits."});
});
const decisionSchema=z.object({approve:z.boolean(),reason:z.string().trim().min(5).max(500)});
const invalid=(message:string,errorCode:string,httpStatus=400)=>Object.assign(new Error(message),{message,errorCode,httpStatus});

export function createAccountingJournalsRouter(postJournal:PostJournal){
  const router=Router();
  router.get("/manual-journals",requireAuth,async(req,res,next)=>{
    try{
      const q=await pool.query(`SELECT r.id,r.request_number AS "requestNumber",r.effective_date::text AS "effectiveDate",r.description,r.reason,r.status,r.created_at AS "createdAt",u.full_name AS "requestedBy",d.full_name AS "decidedBy",r.decision_reason AS "decisionReason",je.entry_number AS "journalEntryNumber",COALESCE((SELECT json_agg(json_build_object('accountId',l.account_id,'accountCode',a.code,'accountName',a.name,'description',l.description,'debit',l.debit::numeric,'credit',l.credit::numeric) ORDER BY l.line_number) FROM manual_journal_request_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=r.company_id AND l.request_id=r.id),'[]'::json) AS lines FROM manual_journal_requests r JOIN users u ON u.company_id=r.company_id AND u.id=r.requested_by LEFT JOIN users d ON d.company_id=r.company_id AND d.id=r.decision_by LEFT JOIN journal_entries je ON je.company_id=r.company_id AND je.id=r.journal_entry_id WHERE r.company_id=$1 AND (r.requested_by=$2 OR EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.company_id=r.company_id AND ur.user_id=$2 AND p.code='accounting.journal.approve')) AND ($3::uuid IS NULL OR r.branch_id IS NULL OR r.branch_id=$3) ORDER BY r.created_at DESC LIMIT 200`,[req.auth!.companyId,req.auth!.userId,req.auth!.branchId]);
      return res.json({requests:q.rows});
    }catch(e){return next(e);}
  });
  router.post("/manual-journals",requireAuth,requirePermission("accounting.journal.create"),async(req,res,next)=>{
    const parsed=requestSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Enter a reason, date and description. Add 2–50 lines with one debit or credit per line; totals must balance."}});
    const x=parsed.data,cid=req.auth!.companyId,actor=req.auth!.userId,key=(req.get("Idempotency-Key")??"").trim(),operation="accounting.manual_journal.create",client=await pool.connect();
    try{await client.query("BEGIN");const claim=await claimIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey:key,body:x});if(claim.replay){await client.query("COMMIT");return res.status(claim.status).json(claim.body);}
      const accounts=await client.query<{id:string;code:string}>("SELECT id,code FROM accounts WHERE company_id=$1 AND id=ANY($2::uuid[]) AND active=true",[cid,x.lines.map(l=>l.accountId)]);if(accounts.rowCount!==new Set(x.lines.map(l=>l.accountId)).size)throw invalid("Choose active ledger accounts for every line.","ACCOUNT_INVALID");
      const branch=req.auth!.branchId??null;if(branch){const b=await client.query("SELECT 1 FROM branches WHERE company_id=$1 AND id=$2 AND active=true",[cid,branch]);if(!b.rowCount)throw invalid("Your assigned branch is inactive.","BRANCH_INVALID",403);}
      await client.query("INSERT INTO number_sequences(company_id,document_type,prefix,next_value,padding) VALUES($1,'manual_journal','MJE-',1,5) ON CONFLICT DO NOTHING",[cid]);
      const seq=await client.query<{request_number:string}>("UPDATE number_sequences SET next_value=next_value+1,updated_at=now() WHERE company_id=$1 AND branch_id IS NULL AND financial_year_id IS NULL AND document_type='manual_journal' RETURNING prefix||lpad((next_value-1)::text,padding,'0') AS request_number",[cid]);
      const number=seq.rows[0]?.request_number;if(!number)throw new Error("Manual journal request sequence is unavailable.");
      const saved=await client.query<{id:string}>("INSERT INTO manual_journal_requests(company_id,request_number,effective_date,description,reason,branch_id,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[cid,number,x.effectiveDate,x.description,x.reason,branch,actor]);
      for(const [i,line] of x.lines.entries())await client.query("INSERT INTO manual_journal_request_lines(company_id,request_id,line_number,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6,$7)",[cid,saved.rows[0].id,i+1,line.accountId,line.description,Math.round(line.debit*100)/100,Math.round(line.credit*100)/100]);
      await client.query("INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,after_data) VALUES($1,$2,$3,'accounting.manual_journal.request','manual_journal_request',$4,$5,$6::jsonb)",[cid,branch,actor,saved.rows[0].id,x.reason,JSON.stringify({requestNumber:number,effectiveDate:x.effectiveDate,lineCount:x.lines.length})]);
      const body={id:saved.rows[0].id,requestNumber:number,status:"pending_approval"};await completeIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey:key,status:201,body});await client.query("COMMIT");return res.status(201).json(body);
    }catch(e){await client.query("ROLLBACK").catch(()=>undefined);const err=e as {httpStatus?:number;errorCode?:string};if(err.httpStatus)return res.status(err.httpStatus).json({error:{code:err.errorCode??"MANUAL_JOURNAL_INVALID",message:(e as Error).message}});return next(e);}finally{client.release();}
  });
  router.post("/manual-journals/:id/decision",requireAuth,requirePermission("accounting.journal.approve"),async(req,res,next)=>{
    const id=z.string().uuid().safeParse(req.params.id),parsed=decisionSchema.safeParse(req.body);if(!id.success)return res.status(404).json({error:{code:"REQUEST_NOT_FOUND",message:"Manual journal request was not found."}});if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Record an approval or rejection with a reason of at least five characters."}});
    const x=parsed.data,cid=req.auth!.companyId,actor=req.auth!.userId,key=(req.get("Idempotency-Key")??"").trim(),operation=`accounting.manual_journal.decision:${id.data}`,client=await pool.connect();
    try{await client.query("BEGIN");const claim=await claimIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey:key,body:x});if(claim.replay){await client.query("COMMIT");return res.status(claim.status).json(claim.body);}
      const head=await client.query<{request_number:string;effective_date:string;description:string;branch_id:string|null;requested_by:string}>("SELECT request_number,effective_date::text,description,branch_id,requested_by FROM manual_journal_requests WHERE company_id=$1 AND id=$2 AND status='pending_approval' AND ($3::uuid IS NULL OR branch_id IS NULL OR branch_id=$3) FOR UPDATE",[cid,id.data,req.auth!.branchId]);if(!head.rowCount)throw invalid("This request is no longer pending or is outside your branch scope.","REQUEST_NOT_PENDING",409);if(head.rows[0].requested_by===actor)throw invalid("The person who submitted a manual journal cannot approve it.","SELF_APPROVAL_NOT_ALLOWED",403);
      let journalEntryId:string|null=null;
      if(x.approve){const rows=await client.query<{accountCode:string;description:string;debit:string;credit:string}>("SELECT a.code AS \"accountCode\",l.description,l.debit::text,l.credit::text FROM manual_journal_request_lines l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id AND a.active=true WHERE l.company_id=$1 AND l.request_id=$2 ORDER BY l.line_number",[cid,id.data]);if((rows.rowCount??0)<2)throw invalid("The request has no valid journal lines.","REQUEST_LINES_INVALID",409);await enforceApprovalLimit(client,{companyId:cid,userId:actor,permissionCode:"accounting.journal.approve",amount:Math.max(rows.rows.reduce((sum,line)=>sum+Number(line.debit),0),rows.rows.reduce((sum,line)=>sum+Number(line.credit),0))});journalEntryId=await postJournal(client,{companyId:cid,actorId:actor,sourceType:"manual_journal",sourceId:id.data,description:head.rows[0].description,effectiveDate:head.rows[0].effective_date,branchId:head.rows[0].branch_id,lines:rows.rows.map(l=>({accountCode:l.accountCode,description:l.description,debit:Number(l.debit),credit:Number(l.credit)}))});}
      const status=x.approve?"posted":"rejected";await client.query("UPDATE manual_journal_requests SET status=$3,decision_by=$4,decision_at=now(),decision_reason=$5,journal_entry_id=$6 WHERE company_id=$1 AND id=$2",[cid,id.data,status,actor,x.reason,journalEntryId]);await client.query("INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,after_data) VALUES($1,$2,$3,$4,'manual_journal_request',$5,$6,$7::jsonb)",[cid,head.rows[0].branch_id,actor,`accounting.manual_journal.${status}`,id.data,x.reason,JSON.stringify({requestNumber:head.rows[0].request_number,journalEntryId})]);
      const body={id:id.data,status,journalEntryId};await completeIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey:key,status:200,body});await client.query("COMMIT");return res.json(body);
    }catch(e){await client.query("ROLLBACK").catch(()=>undefined);const err=e as {httpStatus?:number;errorCode?:string};if(err.httpStatus)return res.status(err.httpStatus).json({error:{code:err.errorCode??"DECISION_REJECTED",message:(e as Error).message}});return next(e);}finally{client.release();}
  });
  return router;
}
