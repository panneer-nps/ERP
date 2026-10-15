import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createPasswordHash } from "../src/auth";
import { pool } from "../src/db";
import { assertDisposableVerificationTarget, assertLocalVerificationApi } from "./verification-target";

const api=process.env.ERP_VERIFY_API_URL??"http://127.0.0.1:4000";
async function cleanAbandonedVerificationUsers(){
  const stale=await pool.query<{id:string;company_id:string}>(`SELECT id,company_id FROM users WHERE email LIKE 'codex-verify-%@example.invalid'`);
  for(const user of stale.rows){const client=await pool.connect();try{await client.query("BEGIN");await client.query("DELETE FROM audit_logs WHERE company_id=$1 AND actor_user_id=$2",[user.company_id,user.id]);await client.query("DELETE FROM user_notifications WHERE company_id=$1 AND recipient_user_id=$2",[user.company_id,user.id]);await client.query(`DELETE FROM company_settings WHERE company_id=$1 AND key='notification_preferences' AND updated_by=$2`,[user.company_id,user.id]);await client.query("DELETE FROM sessions WHERE company_id=$1 AND user_id=$2",[user.company_id,user.id]);await client.query("DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2",[user.company_id,user.id]);await client.query("DELETE FROM users WHERE company_id=$1 AND id=$2",[user.company_id,user.id]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
}
async function main(){
  assertDisposableVerificationTarget();
  assertLocalVerificationApi(api);
  await cleanAbandonedVerificationUsers();
  const owner=await pool.query<{id:string;company_id:string}>(`SELECT u.id,u.company_id FROM users u JOIN user_roles ur ON ur.company_id=u.company_id AND ur.user_id=u.id JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE r.code='owner' AND u.active=true ORDER BY u.created_at LIMIT 1`);
  if(!owner.rowCount)throw new Error("No active owner exists for verification.");
  const companyId=owner.rows[0].company_id,userId=randomUUID(),email=`codex-verify-${randomUUID()}@example.invalid`,password=`Verify-${randomUUID()}-ERP`;
  const priorPreferences=await pool.query<{value:Record<string,boolean>;updated_by:string|null;updated_at:string}>(`SELECT value,updated_by,updated_at FROM company_settings WHERE company_id=$1 AND key='notification_preferences'`,[companyId]);
  let created=false;
  try{
    const hash=await createPasswordHash(password);
    await pool.query(`INSERT INTO users(id,company_id,email,full_name,password_hash) VALUES($1,$2,$3,'Temporary ERP verification user',$4)`,[userId,companyId,email,hash]);created=true;
    await pool.query(`INSERT INTO user_roles(company_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE company_id=$1 AND code='owner'`,[companyId,userId]);
    await pool.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'sales.invoice.post','sales_invoice',$3,jsonb_build_object('invoiceNumber','VERIFY-ONLY')),($1,$2,'sales.receipt.post','customer_receipt',$4,jsonb_build_object('receiptNumber','VERIFY-ONLY'))`,[companyId,userId,randomUUID(),randomUUID()]);
    const loginResponse=await fetch(`${api}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
    const loginBody=await loginResponse.json();
    const token=loginBody.token as string|undefined;
    if(!loginResponse.ok||!token)throw new Error(`Login check returned HTTP ${loginResponse.status}.`);
    const auth={headers:{Authorization:`Bearer ${token}`}};
    const [profileResponse,summaryResponse,invalidRangeResponse,unauthorizedResponse,notificationsResponse]=await Promise.all([
      fetch(`${api}/api/auth/me`,auth),
      fetch(`${api}/api/dashboard/summary?from=2026-10-01&to=2026-10-08`,auth),
      fetch(`${api}/api/dashboard/summary?from=not-a-date&to=2026-10-08`,auth),
      fetch(`${api}/api/dashboard/summary?from=2026-10-01&to=2026-10-08`),
      fetch(`${api}/api/notifications`,auth),
    ]);
    const [profile,summary,invalidRange,notificationBody]=await Promise.all([profileResponse.json(),summaryResponse.json(),invalidRangeResponse.json(),notificationsResponse.json()]);
    const preferenceResponse=await fetch(`${api}/api/notifications/preferences`,{method:"PUT",headers:{...auth.headers,"Content-Type":"application/json"},body:JSON.stringify(notificationBody.preferences)});
    const testNotification=notificationBody.notifications?.find((item:{bodyEn:string})=>item.bodyEn.includes("VERIFY-ONLY"));
    const disabledPreferences={...notificationBody.preferences,sales_invoice:false};
    const disablePreferenceResponse=await fetch(`${api}/api/notifications/preferences`,{method:"PUT",headers:{...auth.headers,"Content-Type":"application/json"},body:JSON.stringify(disabledPreferences)});
    await pool.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'sales.invoice.post','sales_invoice',$3,jsonb_build_object('invoiceNumber','VERIFY-SUPPRESSED'))`,[companyId,userId,randomUUID()]);
    const suppressedInboxResponse=await fetch(`${api}/api/notifications`,auth),suppressedInbox=await suppressedInboxResponse.json();
    const restorePreferenceResponse=await fetch(`${api}/api/notifications/preferences`,{method:"PUT",headers:{...auth.headers,"Content-Type":"application/json"},body:JSON.stringify(notificationBody.preferences)});
    await pool.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'sales.invoice.post','sales_invoice',$3,jsonb_build_object('invoiceNumber','VERIFY-RESTORED'))`,[companyId,userId,randomUUID()]);
    const restoredInboxResponse=await fetch(`${api}/api/notifications`,auth),restoredInbox=await restoredInboxResponse.json();
    let markReadStatus=0,markAllStatus=0,notificationsCleared=false;
    if(testNotification){const marked=await fetch(`${api}/api/notifications/${testNotification.id}/read`,{method:"POST",headers:auth.headers});markReadStatus=marked.status;const all=await fetch(`${api}/api/notifications/read-all`,{method:"POST",headers:auth.headers});markAllStatus=all.status;const after=await fetch(`${api}/api/notifications`,auth);const afterBody=await after.json();notificationsCleared=after.ok&&afterBody.unreadCount===0&&afterBody.notifications.filter((item:{bodyEn:string;readAt:string|null})=>item.bodyEn.includes("VERIFY-ONLY")).every((item:{readAt:string|null})=>item.readAt!==null);}
    const check={check:"login-profile-dashboard-notifications-runtime",loginStatus:loginResponse.status,profileStatus:profileResponse.status,profileShape:profileResponse.ok&&profile.user?.id===userId&&Array.isArray(profile.user?.permissions),summaryStatus:summaryResponse.status,summaryShape:summaryResponse.ok&&summary.from==="2026-10-01"&&summary.to==="2026-10-08"&&typeof summary.sales==="string"&&typeof summary.collections==="string"&&typeof summary.expenses==="string"&&typeof summary.receivables==="string"&&typeof summary.stock?.productCount==="number"&&typeof summary.stock?.value==="string"&&typeof summary.production?.batches==="number"&&typeof summary.chambers?.total==="number"&&typeof summary.pendingApprovals==="number",invalidRangeStatus:invalidRangeResponse.status,invalidRangeRejected:invalidRangeResponse.status===400&&invalidRange.error?.code==="INVALID_DATE_RANGE",unauthorizedStatus:unauthorizedResponse.status,notificationsStatus:notificationsResponse.status,preferencesOwnerOnly:notificationBody.canManagePreferences===true,preferencesSaveStatus:preferenceResponse.status,preferenceDisableStatus:disablePreferenceResponse.status,preferenceSuppressedEvent:suppressedInboxResponse.ok&&!suppressedInbox.notifications.some((item:{bodyEn:string})=>item.bodyEn.includes("VERIFY-SUPPRESSED")),preferenceRestoreStatus:restorePreferenceResponse.status,preferenceRestoreDelivered:restoredInboxResponse.ok&&restoredInbox.notifications.some((item:{bodyEn:string})=>item.bodyEn.includes("VERIFY-RESTORED")),notificationsGenerated:notificationsResponse.ok&&notificationBody.unreadCount===2&&notificationBody.notifications.some((item:{bodyEn:string})=>item.bodyEn.includes("VERIFY-ONLY")),markReadStatus,markAllStatus,notificationsCleared};
    console.log(JSON.stringify(check));
    if(!check.profileShape||!check.summaryShape||!check.invalidRangeRejected||check.unauthorizedStatus!==401||notificationBody.canManagePreferences!==true||preferenceResponse.status!==200||disablePreferenceResponse.status!==200||!check.preferenceSuppressedEvent||restorePreferenceResponse.status!==200||!check.preferenceRestoreDelivered||!check.notificationsGenerated||markReadStatus!==200||markAllStatus!==200||!notificationsCleared)process.exitCode=1;
  }finally{
    if(created){const client=await pool.connect();try{await client.query("BEGIN");await client.query("DELETE FROM audit_logs WHERE company_id=$1 AND actor_user_id=$2",[companyId,userId]);if(priorPreferences.rowCount)await client.query(`UPDATE company_settings SET value=$2::jsonb,updated_by=$3,updated_at=$4 WHERE company_id=$1 AND key='notification_preferences'`,[companyId,JSON.stringify(priorPreferences.rows[0].value),priorPreferences.rows[0].updated_by,priorPreferences.rows[0].updated_at]);else await client.query(`DELETE FROM company_settings WHERE company_id=$1 AND key='notification_preferences' AND updated_by=$2`,[companyId,userId]);await client.query("DELETE FROM sessions WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await client.query("DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2",[companyId,userId]);await client.query("DELETE FROM users WHERE company_id=$1 AND id=$2",[companyId,userId]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}
    await pool.end();
  }
}
main().catch(async error=>{console.error("Login/dashboard runtime verification failed:",error instanceof Error?error.message:"unknown error");await pool.end();process.exitCode=1;});
