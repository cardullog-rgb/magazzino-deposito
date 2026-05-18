import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Parametri scrypt: N=2^15 dà ~50ms su hw moderno, sicuro per uso interno.
// Memoria richiesta: 128 * N * r ≈ 33 MB → alziamo `maxmem` sopra il default
// Node (32 MB) per evitare ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
const SCRYPT_N = 1 << 15;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const KEY_LEN = 64;
const FORMAT_TAG = "scrypt";

/**
 * Hash una password in plain text → stringa autocontenuta che incorpora i
 * parametri kdf, il salt e la chiave. Formato: scrypt$N$r$p$salt$key (hex).
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: SCRYPT_MAXMEM });
  return `${FORMAT_TAG}$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Verifica la password contro l'hash memorizzato. Costante in tempo per
 * evitare timing attacks. Restituisce false su qualunque problema.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT_TAG) return false;
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(saltHex, "hex");
  const stored_key = Buffer.from(keyHex, "hex");
  try {
    const candidate = scryptSync(plain, salt, stored_key.length, { N, r, p, maxmem: SCRYPT_MAXMEM });
    return candidate.length === stored_key.length && timingSafeEqual(candidate, stored_key);
  } catch {
    return false;
  }
}

/**
 * True se la stringa ha il formato di un hash, false se è plain text.
 * Utile per migrare al volo password esistenti.
 */
export function isHashedPassword(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith(`${FORMAT_TAG}$`);
}
