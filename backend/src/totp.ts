import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export class TotpKeyConfigurationError extends Error {
  constructor() { super("TOTP_ENCRYPTION_KEY must be a 64-character hexadecimal key."); }
}

function encryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) throw new TotpKeyConfigurationError();
  return Buffer.from(raw, "hex");
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64url")).join(".");
}

export function decryptTotpSecret(value: string): string {
  const [ivText, tagText, bodyText] = value.split(".");
  if (!ivText || !tagText || !bodyText) throw new Error("Stored authenticator secret is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
}

export function generateTotpSecret(): string {
  let bits = 0, value = 0, result = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function decodeBase32(input: string): Buffer {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of input.toUpperCase().replace(/=+$/g, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Authenticator secret is invalid.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function codeAt(secret: string, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Exposed for deterministic local verification and authenticator interoperability checks. */
export function generateTotpCode(secret: string, now = Date.now()): string {
  return codeAt(secret, Math.floor(now / 30_000));
}

export function matchingTotpCounter(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const submitted = Buffer.from(code);
  const counter = Math.floor(now / 30_000);
  for (const skew of [0, -1, 1]) {
    const expected = Buffer.from(codeAt(secret, counter + skew));
    if (timingSafeEqual(submitted, expected)) return counter + skew;
  }
  return null;
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  return matchingTotpCounter(secret, code, now) !== null;
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(10).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"));
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

export function verifyTotpOrRecovery(secret: string, recoveryHashes: string[], code: string): { valid: boolean; recoveryHashes?: string[]; totpCounter?: number } {
  const totpCounter = matchingTotpCounter(secret, code);
  if (totpCounter !== null) return { valid: true, totpCounter };
  const submitted = Buffer.from(hashRecoveryCode(code));
  const index = recoveryHashes.findIndex(hash => {
    const expected = Buffer.from(hash);
    return expected.length === submitted.length && timingSafeEqual(expected, submitted);
  });
  if (index < 0) return { valid: false };
  return { valid: true, recoveryHashes: recoveryHashes.filter((_, item) => item !== index) };
}
