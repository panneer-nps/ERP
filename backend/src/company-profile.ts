import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { deletePrivateObject, getPrivateObject, putPrivateObject } from "./object-storage";

export const companyProfileRouter = Router();
companyProfileRouter.use(requireAuth);

const logoSchema = z.object({ data: z.string().min(16).max(1_400_000) });
function decodeLogo(value: string): { bytes: Buffer; contentType: string; extension: string } | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 12 || bytes.length > 1_048_576 || bytes.toString("base64") !== value) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { bytes, contentType: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, contentType: "image/jpeg", extension: "jpg" };
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { bytes, contentType: "image/webp", extension: "webp" };
  return null;
}

companyProfileRouter.get("/logo", async (req, res, next) => {
  try {
    const result = await pool.query<{ logo_data: Buffer | null; logo_storage_key: string | null; logo_content_type: string | null }>("SELECT logo_data,logo_storage_key,logo_content_type FROM companies WHERE id=$1 AND active=true", [req.auth!.companyId]);
    if (!result.rowCount || (!result.rows[0].logo_data && !result.rows[0].logo_storage_key)) return res.status(404).json({ error: { code: "COMPANY_LOGO_NOT_FOUND", message: "No company logo has been uploaded." } });
    const logo = result.rows[0];
    const bytes = logo.logo_data ?? (logo.logo_storage_key ? await getPrivateObject(logo.logo_storage_key) : null);
    if (!bytes || !logo.logo_content_type) return res.status(503).json({ error: { code: "COMPANY_LOGO_UNAVAILABLE", message: "The company logo is temporarily unavailable." } });
    res.setHeader("Content-Type", logo.logo_content_type);
    res.setHeader("Content-Length", bytes.length);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(bytes);
  } catch (error) { return next(error); }
});

companyProfileRouter.put("/logo", async (req, res, next) => {
  const parsed = logoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "COMPANY_LOGO_INVALID", message: "Choose a PNG, JPEG or WebP logo no larger than 1 MB." } });
  const decoded = decodeLogo(parsed.data.data);
  if (!decoded) return res.status(400).json({ error: { code: "COMPANY_LOGO_INVALID", message: "Choose a valid PNG, JPEG or WebP logo no larger than 1 MB." } });
  const cid = req.auth!.companyId, actor = req.auth!.userId;
  let uploadedKey: string | null = null;
  let committed = false;
  try {
    if (!(await isOwner(cid, actor))) return res.status(403).json({ error: { code: "COMPANY_PROFILE_FORBIDDEN", message: "Only a company Owner can change company settings." } });
    const before = await pool.query<{ logo_storage_key: string | null }>("SELECT logo_storage_key FROM companies WHERE id=$1 AND active=true", [cid]);
    if (!before.rowCount) return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "Company settings were not found." } });
    const objectKey = `company-logos/${cid}/${randomUUID()}.${decoded.extension}`;
    if (await putPrivateObject(objectKey, decoded.bytes, decoded.contentType)) uploadedKey = objectKey;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE companies SET logo_data=$2,logo_storage_key=$3,logo_content_type=$4,logo_byte_size=$5,updated_at=now() WHERE id=$1", [cid, uploadedKey ? null : decoded.bytes, uploadedKey, decoded.contentType, decoded.bytes.length]);
      await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,$2,'company.logo.update','company',$3::text,$4::jsonb)", [cid, actor, cid, JSON.stringify({ contentType: decoded.contentType, byteSize: decoded.bytes.length })]);
      await client.query("COMMIT");
      committed = true;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
    if (before.rows[0].logo_storage_key) await deletePrivateObject(before.rows[0].logo_storage_key).catch(() => undefined);
    return res.json({ success: true });
  } catch (error) {
    if (uploadedKey && !committed) await deletePrivateObject(uploadedKey).catch(() => undefined);
    return next(error);
  }
});

companyProfileRouter.delete("/logo", async (req, res, next) => {
  const cid = req.auth!.companyId, actor = req.auth!.userId;
  const client = await pool.connect();
  let oldKey: string | null = null;
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ owner: boolean }>("SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND r.code='owner') AS owner", [cid, actor]);
    if (!owner.rows[0]?.owner) { await client.query("ROLLBACK"); return res.status(403).json({ error: { code: "COMPANY_PROFILE_FORBIDDEN", message: "Only a company Owner can change company settings." } }); }
    const before = await client.query<{ logo_storage_key: string | null }>("SELECT logo_storage_key FROM companies WHERE id=$1 AND active=true FOR UPDATE", [cid]);
    if (!before.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "Company settings were not found." } }); }
    oldKey = before.rows[0].logo_storage_key;
    await client.query("UPDATE companies SET logo_data=NULL,logo_storage_key=NULL,logo_content_type=NULL,logo_byte_size=NULL,updated_at=now() WHERE id=$1", [cid]);
    await client.query("INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id) VALUES($1,$2,'company.logo.remove','company',$3::text)", [cid, actor, cid]);
    await client.query("COMMIT");
    if (oldKey) await deletePrivateObject(oldKey).catch(() => undefined);
    return res.status(204).end();
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); return next(error); }
  finally { client.release(); }
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(160).default(""),
  addressLine1: z.string().trim().max(200).default(""),
  addressLine2: z.string().trim().max(200).default(""),
  city: z.string().trim().max(100).default(""),
  district: z.string().trim().max(100).default(""),
  state: z.string().trim().max(100).default(""),
  pincode: z.string().trim().regex(/^(|[0-9]{6})$/).default(""),
  phone: z.string().trim().max(24).regex(/^(|[+0-9()\-\s]{7,24})$/).default(""),
  gstin: z.string().trim().toUpperCase().regex(/^(|[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])$/).default(""),
  pan: z.string().trim().toUpperCase().regex(/^(|[A-Z]{5}[0-9]{4}[A-Z])$/).default(""),
  timezone: z.string().trim().min(1).max(100),
});

async function isOwner(companyId: string, userId: string) {
  const result = await pool.query<{ owner: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND r.code='owner') AS owner",
    [companyId, userId],
  );
  return result.rows[0]?.owner === true;
}

companyProfileRouter.get("/", async (req, res, next) => {
  try {
    if (!(await isOwner(req.auth!.companyId, req.auth!.userId))) {
      return res.status(403).json({ error: { code: "COMPANY_PROFILE_FORBIDDEN", message: "Only a company Owner can view company settings." } });
    }
    const result = await pool.query(`SELECT name,legal_name AS "legalName",address,gstin,pan,timezone
      FROM companies WHERE id=$1 AND active=true`, [req.auth!.companyId]);
    if (!result.rowCount) return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "Company settings were not found." } });
    const row = result.rows[0] as { name: string; legalName: string | null; address: Record<string, string> | null; gstin: string | null; pan: string | null; timezone: string };
    const address = row.address ?? {};
    return res.json({ profile: {
      name: row.name,
      legalName: row.legalName ?? "",
      addressLine1: address.addressLine1 ?? "",
      addressLine2: address.addressLine2 ?? "",
      city: address.city ?? "",
      district: address.district ?? "",
      state: address.state ?? "",
      pincode: address.pincode ?? "",
      phone: address.phone ?? "",
      gstin: row.gstin ?? "",
      pan: row.pan ?? "",
      timezone: row.timezone,
    } });
  } catch (error) { return next(error); }
});

companyProfileRouter.put("/", async (req, res, next) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "COMPANY_PROFILE_INVALID", message: "Check the company name, six-digit pincode, contact number, GSTIN, PAN and timezone." } });
  const x = parsed.data;
  const cid = req.auth!.companyId;
  const actor = req.auth!.userId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ owner: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.company_id=ur.company_id AND r.id=ur.role_id WHERE ur.company_id=$1 AND ur.user_id=$2 AND r.code='owner') AS owner",
      [cid, actor],
    );
    if (!owner.rows[0]?.owner) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "COMPANY_PROFILE_FORBIDDEN", message: "Only a company Owner can change company settings." } });
    }
    const before = await client.query("SELECT name,legal_name,address,gstin,pan,timezone FROM companies WHERE id=$1 AND active=true FOR UPDATE", [cid]);
    if (!before.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "COMPANY_NOT_FOUND", message: "Company settings were not found." } });
    }
    const validTimezone = await client.query("SELECT 1 FROM pg_timezone_names WHERE name=$1", [x.timezone]);
    if (!validTimezone.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "TIMEZONE_INVALID", message: "Choose a timezone recognized by PostgreSQL, such as Asia/Kolkata." } });
    }
    const address = { addressLine1: x.addressLine1, addressLine2: x.addressLine2, city: x.city, district: x.district, state: x.state, pincode: x.pincode, phone: x.phone };
    await client.query(`UPDATE companies SET name=$2,legal_name=NULLIF($3,''),address=$4::jsonb,gstin=NULLIF($5,''),pan=NULLIF($6,''),timezone=$7,updated_at=now() WHERE id=$1`,
      [cid, x.name, x.legalName, JSON.stringify(address), x.gstin, x.pan, x.timezone]);
    const after = { ...x, address };
    await client.query(`INSERT INTO audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
      VALUES($1,$2,'company.profile.update','company',$3::text,$4::jsonb,$5::jsonb)`,
      [cid, actor, cid, JSON.stringify(before.rows[0]), JSON.stringify(after)]);
    await client.query("COMMIT");
    return res.json({ success: true, profile: x });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return next(error);
  } finally { client.release(); }
});
