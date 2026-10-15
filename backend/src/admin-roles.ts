import { Router } from "express";
import { z } from "zod";
import { createPasswordHash, requireAuth, requirePermission } from "./auth";
import { pool } from "./db";
import { claimIdempotencyKey, completeIdempotencyKey } from "./idempotency";

export const adminRolesRouter = Router();
adminRolesRouter.use(requireAuth);

const roleSchema = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().trim().min(2).max(80),
  permissionCodes: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
});
const roleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  permissionCodes: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
}).refine((x) => x.name !== undefined || x.permissionCodes !== undefined);
const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
  roleIds: z.array(z.string().uuid()).min(1).max(10),
  branchIds: z.array(z.string().uuid()).max(100).default([]),
});
const userRolesSchema = z.object({ roleIds: z.array(z.string().uuid()).min(1).max(10) });
const resetPasswordSchema = z.object({ password: z.string().min(12).max(128) });
const forbiddenPermission = "users.roles.manage";
const approvalLimitPermissionCodes = [
  "expenses.approve", "sales.approve", "employees.advance.approve", "brokers.commission.approve",
  "brokers.commission.pay", "cash.close.approve", "payroll.approve", "payroll.pay",
  "accounting.journal.approve", "purchases.credit.refund", "stocktake.approve",
] as const;
const approvalLimitsSchema = z.object({
  limits: z.array(z.object({
    permissionCode: z.string().min(1).max(100),
    maxAmount: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/),
  })).max(approvalLimitPermissionCodes.length),
});

function error(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { httpStatus: status, errorCode: code });
}

async function savePermissions(client: import("pg").PoolClient, roleId: string, permissionCodes: string[]) {
  const codes = [...new Set(permissionCodes)];
  if (codes.includes(forbiddenPermission)) throw error(400, "PRIVILEGE_ESCALATION", "The role-management permission can only be held by the system Owner role.");
  const found = await client.query<{id:string;code:string}>("SELECT id,code FROM permissions WHERE code=ANY($1::text[])", [codes]);
  if (found.rowCount !== codes.length) throw error(400, "UNKNOWN_PERMISSION", "One or more selected permissions are unavailable.");
  await client.query("DELETE FROM role_permissions WHERE role_id=$1", [roleId]);
  if (found.rowCount) {
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=ANY($2::text[]) ON CONFLICT DO NOTHING", [roleId, codes]);
  }
  await client.query("DELETE FROM role_approval_limits WHERE role_id=$1 AND NOT (permission_code=ANY($2::text[]))", [roleId, codes]);
  return codes;
}

adminRolesRouter.get("/roles", requirePermission("users.roles.manage"), async (req, res, next) => {
  try {
    const [roles, permissions, limits] = await Promise.all([
      pool.query(`SELECT r.id,r.code,r.name,r.read_only AS "readOnly",r.system_role AS "systemRole",
        count(DISTINCT ur.user_id)::int AS "userCount",
        COALESCE(array_agg(DISTINCT p.code) FILTER(WHERE p.code IS NOT NULL),'{}') AS "permissionCodes"
        FROM roles r LEFT JOIN user_roles ur ON ur.company_id=r.company_id AND ur.role_id=r.id
        LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id
        WHERE r.company_id=$1 GROUP BY r.id ORDER BY (r.code='owner') DESC,r.system_role DESC,lower(r.name)`, [req.auth!.companyId]),
      pool.query("SELECT code,module,action,description FROM permissions WHERE code<>$1 ORDER BY module,action,code", [forbiddenPermission]),
      pool.query<{role_id:string;permission_code:string;max_amount:string}>("SELECT role_id,permission_code,max_amount::text FROM role_approval_limits WHERE company_id=$1",[req.auth!.companyId]),
    ]);
    const byRole=new Map<string,Record<string,string>>();
    for(const limit of limits.rows){const values=byRole.get(limit.role_id)??{};values[limit.permission_code]=limit.max_amount;byRole.set(limit.role_id,values);}
    return res.json({ roles: roles.rows.map(role=>({...role,approvalLimits:byRole.get(role.id)??{}})), permissions: permissions.rows });
  } catch (e) { return next(e); }
});

adminRolesRouter.put("/roles/:id/approval-limits",requirePermission("users.roles.manage"),async(req,res,next)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=approvalLimitsSchema.safeParse(req.body);
  if(!id.success)return res.status(404).json({error:{code:"ROLE_NOT_FOUND",message:"The role was not found."}});
  if(!parsed.success)return res.status(400).json({error:{code:"APPROVAL_LIMITS_INVALID",message:"Enter non-negative INR limits with up to two decimal places."}});
  const limits=parsed.data.limits,codes=limits.map(x=>x.permissionCode),allowed=new Set<string>(approvalLimitPermissionCodes);
  if(new Set(codes).size!==codes.length||codes.some(code=>!allowed.has(code)))return res.status(400).json({error:{code:"APPROVAL_LIMIT_PERMISSION_INVALID",message:"Choose each supported approval or payment action only once."}});
  const cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();
  try{
    await client.query("BEGIN");
    const role=await client.query<{id:string;code:string}>("SELECT id,code FROM roles WHERE company_id=$1 AND id=$2 FOR UPDATE",[cid,id.data]);
    if(!role.rowCount)throw error(404,"ROLE_NOT_FOUND","The role was not found.");
    if(role.rows[0].code==="owner")throw error(409,"OWNER_LIMITS_UNNECESSARY","Owner approvals are not restricted by staff-role limits.");
    const assigned=await client.query<{code:string}>("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.code=ANY($2::text[])",[id.data,codes]);
    if(assigned.rowCount!==codes.length)throw error(400,"ROLE_PERMISSION_REQUIRED","A role can only receive limits for approval or payment actions it is allowed to perform.");
    const before=await client.query<{permission_code:string;max_amount:string}>("SELECT permission_code,max_amount::text FROM role_approval_limits WHERE company_id=$1 AND role_id=$2 ORDER BY permission_code FOR UPDATE",[cid,id.data]);
    await client.query("DELETE FROM role_approval_limits WHERE company_id=$1 AND role_id=$2",[cid,id.data]);
    for(const limit of limits)await client.query("INSERT INTO role_approval_limits(company_id,role_id,permission_code,max_amount,updated_by) VALUES($1,$2,$3,$4::numeric,$5)",[cid,id.data,limit.permissionCode,limit.maxAmount,actor]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'users.role.approval_limits.update','role',$3,$4::jsonb,$5::jsonb)",[cid,actor,id.data,JSON.stringify({limits:before.rows.map(x=>({permissionCode:x.permission_code,maxAmount:x.max_amount}))}),JSON.stringify({limits})]);
    await client.query("COMMIT");return res.json({success:true,limits});
  }catch(e){await client.query("ROLLBACK").catch(()=>undefined);const s=(e as {httpStatus?:number}).httpStatus;if(s)return res.status(s).json({error:{code:(e as {errorCode?:string}).errorCode,message:(e as Error).message}});return next(e);}finally{client.release();}
});

adminRolesRouter.post("/roles", requirePermission("users.roles.manage"), async (req, res, next) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a role code and name, then choose valid permissions." } });
  const x=parsed.data,cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();
  try {
    await client.query("BEGIN");
    const role=await client.query<{id:string}>("INSERT INTO roles(company_id,code,name,read_only,system_role) VALUES($1,$2,$3,false,false) RETURNING id",[cid,x.code,x.name]);
    const permissions=await savePermissions(client,role.rows[0].id,x.permissionCodes);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'users.role.create','role',$3,$4::jsonb)",[cid,actor,role.rows[0].id,JSON.stringify({code:x.code,name:x.name,permissionCodes:permissions})]);
    await client.query("COMMIT");return res.status(201).json({id:role.rows[0].id});
  } catch(e) { await client.query("ROLLBACK").catch(()=>undefined);if((e as {code?:string}).code==="23505")return res.status(409).json({error:{code:"ROLE_CODE_EXISTS",message:"That role code is already in use."}});const s=(e as {httpStatus?:number}).httpStatus;if(s)return res.status(s).json({error:{code:(e as {errorCode?:string}).errorCode,message:(e as Error).message}});return next(e); } finally { client.release(); }
});

adminRolesRouter.patch("/roles/:id", requirePermission("users.roles.manage"), async (req,res,next) => {
  const id=z.string().uuid().safeParse(req.params.id),parsed=roleUpdateSchema.safeParse(req.body);
  if(!id.success)return res.status(404).json({error:{code:"ROLE_NOT_FOUND",message:"The role was not found."}});
  if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Provide a role name or a valid permission list."}});
  const cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();
  try {
    await client.query("BEGIN");
    const before=await client.query<{id:string;code:string;name:string;system_role:boolean;read_only:boolean}>("SELECT id,code,name,system_role,read_only FROM roles WHERE company_id=$1 AND id=$2 FOR UPDATE",[cid,id.data]);
    if(!before.rowCount)throw error(404,"ROLE_NOT_FOUND","The role was not found.");
    if(before.rows[0].system_role||before.rows[0].read_only)throw error(409,"SYSTEM_ROLE_PROTECTED","Built-in and read-only roles cannot be edited.");
    const beforePermissions=await client.query<{code:string}>("SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 ORDER BY p.code",[id.data]);
    const beforePermissionCodes=beforePermissions.rows.map(r=>r.code);
    const permissionCodes=parsed.data.permissionCodes?await savePermissions(client,id.data,parsed.data.permissionCodes):undefined;
    if(parsed.data.name!==undefined)await client.query("UPDATE roles SET name=$3 WHERE company_id=$1 AND id=$2",[cid,id.data,parsed.data.name]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'users.role.update','role',$3,$4::jsonb,$5::jsonb)",[cid,actor,id.data,JSON.stringify({code:before.rows[0].code,name:before.rows[0].name,permissionCodes:beforePermissionCodes}),JSON.stringify({code:before.rows[0].code,name:parsed.data.name??before.rows[0].name,permissionCodes:permissionCodes??beforePermissionCodes})]);
    await client.query("COMMIT");return res.json({success:true});
  } catch(e) { await client.query("ROLLBACK").catch(()=>undefined);const s=(e as {httpStatus?:number}).httpStatus;if(s)return res.status(s).json({error:{code:(e as {errorCode?:string}).errorCode,message:(e as Error).message}});return next(e); } finally { client.release(); }
});

adminRolesRouter.post("/users", requirePermission("users.create"), requirePermission("users.roles.manage"), async(req,res,next) => {
  const parsed=createUserSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Enter the name, valid email, 12-character password and at least one role."}});
  const x=parsed.data,cid=req.auth!.companyId,actor=req.auth!.userId,operation="admin.user.create",requestKey=(req.get("Idempotency-Key")??"").trim(),client=await pool.connect();
  try {
    await client.query("BEGIN");
    const claim=await claimIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,body:x});
    if(claim.replay){await client.query("COMMIT");return res.status(claim.status).json(claim.body);}
    const roles=await client.query<{id:string;code:string;name:string;read_only:boolean}>("SELECT id,code,name,read_only FROM roles WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE",[cid,[...new Set(x.roleIds)]]);
    if(roles.rowCount!==new Set(x.roleIds).size)throw error(400,"INVALID_ROLE","Choose roles from this company.");
    if(roles.rows.some(r=>r.code==="owner"))throw error(400,"OWNER_ASSIGNMENT_BLOCKED","The protected Owner role cannot be assigned here.");
    if(roles.rows.some(r=>r.read_only)&&roles.rows.length>1)throw error(400,"READ_ONLY_ROLE_MIXED","A read-only role cannot be combined with another role.");
    const branchIds=[...new Set(x.branchIds)];
    const branches=await client.query<{id:string}>("SELECT id FROM branches WHERE company_id=$1 AND active=true AND id=ANY($2::uuid[]) FOR SHARE",[cid,branchIds]);
    if(branches.rowCount!==branchIds.length)throw error(400,"INVALID_BRANCH_ASSIGNMENT","Choose active branches from this company.");
    const passwordHash=await createPasswordHash(x.password),user=await client.query<{id:string}>("INSERT INTO users(company_id,email,full_name,password_hash) VALUES($1,lower($2),$3,$4) RETURNING id",[cid,x.email,x.fullName,passwordHash]);
    for(const role of roles.rows)await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)",[cid,user.rows[0].id,role.id]);
    for(const branchId of branchIds)await client.query("INSERT INTO user_branches(company_id,user_id,branch_id) VALUES($1,$2,$3)",[cid,user.rows[0].id,branchId]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'users.create','user',$3,$4::jsonb)",[cid,actor,user.rows[0].id,JSON.stringify({email:x.email.toLowerCase(),fullName:x.fullName,roles:roles.rows.map(r=>r.code),branchIds})]);
    const response={id:user.rows[0].id,roles:roles.rows.map(r=>r.code)};
    await completeIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,status:201,body:response});
    await client.query("COMMIT");return res.status(201).json(response);
  } catch(e) { await client.query("ROLLBACK").catch(()=>undefined);if((e as {code?:string}).code==="23505")return res.status(409).json({error:{code:"USER_EMAIL_EXISTS",message:"An account already uses that email address."}});const s=(e as {httpStatus?:number}).httpStatus;if(s)return res.status(s).json({error:{code:(e as {errorCode?:string}).errorCode,message:(e as Error).message}});return next(e); } finally { client.release(); }
});

adminRolesRouter.post("/users/:id/password", requirePermission("users.roles.manage"), async(req,res,next) => {
  const id=z.string().uuid().safeParse(req.params.id),parsed=resetPasswordSchema.safeParse(req.body);
  if(!id.success)return res.status(404).json({error:{code:"USER_NOT_FOUND",message:"The user was not found."}});
  if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Enter a password containing at least 12 characters."}});
  const cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();
  try {
    await client.query("BEGIN");
    const owner=await client.query<{is_owner:boolean}>("SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND r.code='owner') AS is_owner",[cid,actor]);
    if(!owner.rows[0]?.is_owner)throw error(403,"OWNER_REQUIRED","Only the company Owner can reset a staff password.");
    if(id.data===actor)throw error(409,"CANNOT_RESET_SELF","You cannot reset your own password from staff management.");
    const operation="admin.user.password.reset:"+id.data,requestKey=(req.get("Idempotency-Key")??"").trim();
    const claim=await claimIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,body:parsed.data});
    if(claim.replay){await client.query("COMMIT");return res.status(claim.status).json(claim.body);}
    const user=await client.query<{is_owner:boolean}>("SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=u.company_id AND ur.user_id=u.id AND r.code='owner') AS is_owner FROM users u WHERE u.company_id=$1 AND u.id=$2 FOR UPDATE",[cid,id.data]);
    if(!user.rowCount)throw error(404,"USER_NOT_FOUND","The user was not found.");
    if(user.rows[0].is_owner)throw error(409,"OWNER_PASSWORD_PROTECTED","Owner passwords cannot be reset from staff management.");
    const passwordHash=await createPasswordHash(parsed.data.password);
    await client.query("UPDATE users SET password_hash=$3,updated_at=now() WHERE company_id=$1 AND id=$2",[cid,id.data,passwordHash]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL",[cid,id.data]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'users.password.reset','user',$3,jsonb_build_object('sessionsRevoked',true))",[cid,actor,id.data]);
    const response={success:true};
    await completeIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,status:200,body:response});
    await client.query("COMMIT");
    return res.json(response);
  } catch(e) { await client.query("ROLLBACK").catch(()=>undefined);const s=(e as {httpStatus?:number}).httpStatus;if(s)return res.status(s).json({error:{code:(e as {errorCode?:string}).errorCode,message:(e as Error).message}});return next(e); } finally { client.release(); }
});

adminRolesRouter.put("/users/:id/roles", requirePermission("users.roles.manage"), async(req,res,next) => {
  const id=z.string().uuid().safeParse(req.params.id),parsed=userRolesSchema.safeParse(req.body);if(!id.success)return res.status(404).json({error:{code:"USER_NOT_FOUND",message:"The user was not found."}});if(!parsed.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Choose at least one valid role."}});
  const cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();
  try {
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`user-roles:${cid}`]);
    if(id.data===actor)throw error(409,"CANNOT_CHANGE_OWN_ROLES","You cannot change your own roles.");
    const user=await client.query<{id:string;is_owner:boolean}>("SELECT u.id,EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=u.company_id AND ur.user_id=u.id AND r.code='owner') AS is_owner FROM users u WHERE u.company_id=$1 AND u.id=$2 FOR UPDATE",[cid,id.data]);
    if(!user.rowCount)throw error(404,"USER_NOT_FOUND","The user was not found.");if(user.rows[0].is_owner)throw error(409,"OWNER_ROLE_PROTECTED","The protected Owner role cannot be changed here.");
    const roleIds=[...new Set(parsed.data.roleIds)],roles=await client.query<{id:string;code:string;read_only:boolean}>("SELECT id,code,read_only FROM roles WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE",[cid,roleIds]);
    if(roles.rowCount!==roleIds.length||roles.rows.some(r=>r.code==="owner"))throw error(400,"INVALID_ROLE","Choose only assignable roles from this company.");if(roles.rows.some(r=>r.read_only)&&roles.rows.length>1)throw error(400,"READ_ONLY_ROLE_MIXED","A read-only role cannot be combined with another role.");
    const before=await client.query("SELECT r.code FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2 ORDER BY r.code",[cid,id.data]);
    await client.query("DELETE FROM user_roles WHERE company_id=$1 AND user_id=$2",[cid,id.data]);for(const role of roles.rows)await client.query("INSERT INTO user_roles(company_id,user_id,role_id) VALUES($1,$2,$3)",[cid,id.data,role.id]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL",[cid,id.data]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'users.roles.update','user',$3,$4::jsonb,$5::jsonb)",[cid,actor,id.data,JSON.stringify({roles:before.rows.map(r=>r.code)}),JSON.stringify({roles:roles.rows.map(r=>r.code)})]);
    await client.query("COMMIT");return res.json({success:true,roles:roles.rows.map(r=>r.code)});
  } catch(e) { await client.query("ROLLBACK").catch(()=>undefined);const s=(e as {httpStatus?:number}).httpStatus;if(s)return res.status(s).json({error:{code:(e as {errorCode?:string}).errorCode,message:(e as Error).message}});return next(e); } finally { client.release(); }
});

const branchSchema=z.object({code:z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/).transform(v=>v.toUpperCase()),name:z.string().trim().min(2).max(100)});
const branchAssignmentsSchema=z.object({branchIds:z.array(z.string().uuid()).max(100)});
adminRolesRouter.get("/branches",requirePermission("users.roles.manage"),async(req,res,next)=>{try{const q=await pool.query(`SELECT b.id,b.code,b.name,b.active,b.created_at AS "createdAt" FROM branches b WHERE b.company_id=$1 ORDER BY b.active DESC,lower(b.name)`,[req.auth!.companyId]);return res.json({branches:q.rows});}catch(e){return next(e);}});
adminRolesRouter.post("/branches",requirePermission("users.roles.manage"),async(req,res,next)=>{
  const p=branchSchema.safeParse(req.body);
  if(!p.success)return res.status(400).json({error:{code:"VALIDATION_ERROR",message:"Enter a branch code and name."}});
  const cid=req.auth!.companyId,actor=req.auth!.userId,operation="admin.branch.create",requestKey=(req.get("Idempotency-Key")??"").trim(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const claim=await claimIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,body:p.data});
    if(claim.replay){await client.query("COMMIT");return res.status(claim.status).json(claim.body);}
    const q=await client.query<{id:string}>(`INSERT INTO branches(company_id,code,name) VALUES($1,$2,$3) RETURNING id`,[cid,p.data.code,p.data.name]);
    const branchId=q.rows[0].id,locationCode=`BR-${branchId.replace(/-/g,"").slice(0,12)}`;
    await client.query(`INSERT INTO stock_locations(company_id,code,name,branch_id) VALUES($1,$2,$3,$4)`,[cid,locationCode,`${p.data.name} yard`,branchId]);
    await client.query(`INSERT INTO audit_logs(company_id,branch_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'branch.create','branch',$4,$5::jsonb)`,[cid,branchId,actor,branchId,JSON.stringify(p.data)]);
    const response={id:branchId,...p.data,active:true};
    await completeIdempotencyKey(client,{companyId:cid,userId:actor,operation,requestKey,status:201,body:response});
    await client.query("COMMIT");return res.status(201).json(response);
  }catch(e){
    await client.query("ROLLBACK").catch(()=>undefined);
    if((e as {code?:string}).code==="23505")return res.status(409).json({error:{code:"BRANCH_CODE_EXISTS",message:"A branch already uses that code."}});
    const status=(e as {httpStatus?:number}).httpStatus;
    if(status)return res.status(status).json({error:{code:(e as {errorCode?:string}).errorCode??"BRANCH_CREATE_REJECTED",message:(e as Error).message}});
    return next(e);
  }finally{client.release();}
});
adminRolesRouter.put("/users/:id/branches",requirePermission("users.roles.manage"),async(req,res,next)=>{const id=z.string().uuid().safeParse(req.params.id),p=branchAssignmentsSchema.safeParse(req.body);if(!id.success)return res.status(404).json({error:{code:"USER_NOT_FOUND",message:"The user was not found."}});if(!p.success)return res.status(400).json({error:{code:"INVALID_BRANCH_ASSIGNMENT",message:"Choose valid branches for this user."}});const cid=req.auth!.companyId,actor=req.auth!.userId,client=await pool.connect();try{await client.query("BEGIN");const target=await client.query<{is_owner:boolean}>(`SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=u.company_id AND ur.user_id=u.id AND r.code='owner') AS is_owner FROM users u WHERE u.company_id=$1 AND u.id=$2 FOR UPDATE`,[cid,id.data]);if(!target.rowCount)throw error(404,"USER_NOT_FOUND","The user was not found.");if(target.rows[0].is_owner)throw error(409,"OWNER_BRANCH_SCOPE","Owner accounts have company-wide access and do not need branch assignments.");const ids=[...new Set(p.data.branchIds)];const branches=await client.query<{id:string}>("SELECT id FROM branches WHERE company_id=$1 AND active=true AND id=ANY($2::uuid[])",[cid,ids]);if(branches.rowCount!==ids.length)throw error(400,"INVALID_BRANCH_ASSIGNMENT","Choose active branches from this company.");const before=await client.query<{branch_id:string}>("SELECT branch_id FROM user_branches WHERE company_id=$1 AND user_id=$2 ORDER BY branch_id",[cid,id.data]);await client.query("DELETE FROM user_branches WHERE company_id=$1 AND user_id=$2",[cid,id.data]);for(const branchId of ids)await client.query("INSERT INTO user_branches(company_id,user_id,branch_id) VALUES($1,$2,$3)",[cid,id.data,branchId]);await client.query("UPDATE sessions SET branch_id=NULL,revoked_at=CASE WHEN branch_id IS NOT NULL AND NOT (branch_id=ANY($3::uuid[])) THEN now() ELSE revoked_at END WHERE company_id=$1 AND user_id=$2 AND revoked_at IS NULL",[cid,id.data,ids]);await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,$2,'user.branches.update','user',$3,$4::jsonb,$5::jsonb)",[cid,actor,id.data,JSON.stringify({branchIds:before.rows.map(r=>r.branch_id)}),JSON.stringify({branchIds:ids})]);await client.query("COMMIT");return res.json({success:true,branchIds:ids});}catch(e){await client.query("ROLLBACK").catch(()=>undefined);const status=(e as {httpStatus?:number}).httpStatus;if(status)return res.status(status).json({error:{code:(e as {errorCode?:string}).errorCode??"BRANCH_ASSIGNMENT_REJECTED",message:(e as Error).message}});return next(e);}finally{client.release();}});
