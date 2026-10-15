import { createHash, createHmac } from "node:crypto";

type StorageConfig = {
  endpoint: URL;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function config(): StorageConfig | null {
  // Neon Object Storage's connection panel provides AWS_* variable names.
  // Keep the ERP-specific names as the documented defaults, but accept the
  // standard S3 names too so the Neon values can be pasted into deployment env.
  const endpointValue = process.env.OBJECT_STORAGE_ENDPOINT || process.env.AWS_ENDPOINT_URL_S3;
  const bucketValue = process.env.OBJECT_STORAGE_BUCKET || process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET;
  const regionValue = process.env.OBJECT_STORAGE_REGION || process.env.AWS_REGION;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const values = [
    endpointValue,
    bucketValue,
    regionValue,
    accessKeyId,
    secretAccessKey,
  ];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) throw new Error("Object storage configuration is incomplete.");
  const endpoint = new URL(endpointValue!);
  if (endpoint.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("Object storage must use HTTPS in production.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Object storage endpoint must not contain credentials, a query, or a fragment.");
  }
  const bucket = bucketValue!;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Object storage bucket name is invalid.");
  return {
    endpoint,
    bucket,
    region: regionValue!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    sessionToken: process.env.OBJECT_STORAGE_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN || undefined,
  };
}

export function privateObjectStorageEnabled(): boolean {
  return config() !== null;
}

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
const encodePathPart = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function requestObject(method: "PUT" | "GET" | "DELETE", key: string, bytes?: Buffer, contentType?: string): Promise<Buffer | null> {
  const cfg = config();
  if (!cfg) return null;
  const cleanKey = key.split("/").map(encodePathPart).join("/");
  const basePath = cfg.endpoint.pathname.replace(/\/$/, "");
  const pathname = `${basePath}/${encodePathPart(cfg.bucket)}/${cleanKey}`;
  const url = new URL(cfg.endpoint.toString());
  url.pathname = pathname;
  url.search = "";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(bytes ?? Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  if (cfg.sessionToken) headers["x-amz-security-token"] = cfg.sessionToken;
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const canonicalRequest = [method, pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${cfg.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, cfg.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(url, {
    method,
    headers: { ...headers, authorization },
    body: method === "PUT" && bytes ? new Uint8Array(bytes) : undefined,
    redirect: "error",
  });
  if (!response.ok) throw Object.assign(new Error(`Object storage ${method} failed (${response.status}).`), { status: response.status });
  if (method !== "GET") return null;
  return Buffer.from(await response.arrayBuffer());
}

export async function putPrivateObject(key: string, bytes: Buffer, contentType: string): Promise<boolean> {
  if (!config()) return false;
  await requestObject("PUT", key, bytes, contentType);
  return true;
}

export async function getPrivateObject(key: string): Promise<Buffer | null> {
  return requestObject("GET", key);
}

export async function deletePrivateObject(key: string): Promise<void> {
  if (!config()) return;
  await requestObject("DELETE", key);
}
