/**
 * Browser-side validator for the Kalshi RSA private key (PEM, PKCS#8).
 * Performs structural checks first (BEGIN/END lines, base64 body), then
 * actually attempts a WebCrypto `importKey` + a 1-byte sign to prove the
 * key is usable for `RSA-PSS / SHA-256` — the exact algorithm Kalshi uses.
 */

export type PemStatus =
  | "ok"
  | "empty"
  | "wrong-header"
  | "rsa-pkcs1"
  | "encrypted"
  | "bad-base64"
  | "import-failed"
  | "sign-failed";

export interface PemValidationResult {
  status: PemStatus;
  label: string;
  detail: string;
  /** True only when the key imports AND signs successfully. */
  ok: boolean;
}

const RESULTS: Record<PemStatus, Omit<PemValidationResult, "ok">> = {
  ok: { status: "ok", label: "PEM looks valid", detail: "Key imported and signed a test payload with RSA-PSS / SHA-256." },
  empty: { status: "empty", label: "No key pasted", detail: "Paste your Kalshi RSA private key, including the BEGIN/END lines." },
  "wrong-header": {
    status: "wrong-header",
    label: "Missing PEM headers",
    detail: "Expected '-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----'. Copy the full file from Kalshi.",
  },
  "rsa-pkcs1": {
    status: "rsa-pkcs1",
    label: "Wrong key format (PKCS#1)",
    detail:
      "This is a 'BEGIN RSA PRIVATE KEY' (PKCS#1) file. Kalshi + WebCrypto need PKCS#8. Convert with: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pkcs8.pem",
  },
  encrypted: {
    status: "encrypted",
    label: "Encrypted key not supported",
    detail:
      "This key is password-protected ('BEGIN ENCRYPTED PRIVATE KEY'). Decrypt it first: openssl pkcs8 -in key.pem -out key.unencrypted.pem",
  },
  "bad-base64": {
    status: "bad-base64",
    label: "Invalid base64 body",
    detail: "The text between BEGIN/END lines isn't valid base64. Re-copy the key — make sure no characters were truncated.",
  },
  "import-failed": {
    status: "import-failed",
    label: "WebCrypto rejected the key",
    detail:
      "The browser couldn't import this as an RSA-PSS PKCS#8 key. It's probably an EC key, a public key, or corrupted. Re-export from Kalshi.",
  },
  "sign-failed": {
    status: "sign-failed",
    label: "Key imports but cannot sign",
    detail: "Imported successfully but signing a test payload failed. The key may be missing the private component.",
  },
};

function decodeBase64(b64: string): ArrayBuffer | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer.slice(0);
  } catch {
    return null;
  }
}

export async function validatePem(pemRaw: string): Promise<PemValidationResult> {
  const pem = (pemRaw ?? "").trim();
  if (!pem) return { ...RESULTS.empty, ok: false };

  if (/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) {
    return { ...RESULTS["rsa-pkcs1"], ok: false };
  }
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(pem)) {
    return { ...RESULTS.encrypted, ok: false };
  }
  if (
    !/-----BEGIN PRIVATE KEY-----/.test(pem) ||
    !/-----END PRIVATE KEY-----/.test(pem)
  ) {
    return { ...RESULTS["wrong-header"], ok: false };
  }

  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const buf = decodeBase64(body);
  if (!buf) return { ...RESULTS["bad-base64"], ok: false };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      buf,
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch (e) {
    const msg = (e as Error)?.message?.trim();
    return {
      ...RESULTS["import-failed"],
      detail: msg ? `${RESULTS["import-failed"].detail} (${msg})` : RESULTS["import-failed"].detail,
      ok: false,
    };
  }

  try {
    await crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 },
      key,
      new TextEncoder().encode("kalshi-mm-pem-test")
    );
  } catch (e) {
    const msg = (e as Error)?.message?.trim();
    return {
      ...RESULTS["sign-failed"],
      detail: msg ? `${RESULTS["sign-failed"].detail} (${msg})` : RESULTS["sign-failed"].detail,
      ok: false,
    };
  }

  return { ...RESULTS.ok, ok: true };
}

export const PEM_BADGE_CLASS: Record<PemStatus, string> = {
  ok: "bg-success/15 text-success border-success/40",
  empty: "bg-muted text-muted-foreground border-border",
  "wrong-header": "bg-warning/15 text-warning border-warning/40",
  "rsa-pkcs1": "bg-destructive/15 text-destructive border-destructive/40",
  encrypted: "bg-destructive/15 text-destructive border-destructive/40",
  "bad-base64": "bg-destructive/15 text-destructive border-destructive/40",
  "import-failed": "bg-destructive/15 text-destructive border-destructive/40",
  "sign-failed": "bg-destructive/15 text-destructive border-destructive/40",
};

// =============================================================================
// PKCS#1 → PKCS#8 conversion (no OpenSSL needed)
// =============================================================================

/** ASN.1 DER length encoder (short or long form). */
function encodeLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function chunk(s: string, n: number): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += n) lines.push(s.slice(i, i + n));
  return lines.join("\n");
}

/**
 * Wraps an RSAPrivateKey (PKCS#1) DER blob inside a PrivateKeyInfo (PKCS#8)
 * structure. Per RFC 5208:
 *   PrivateKeyInfo ::= SEQUENCE {
 *     version              INTEGER (0),
 *     privateKeyAlgorithm  AlgorithmIdentifier,
 *     privateKey           OCTET STRING  -- contains the RSAPrivateKey
 *   }
 * AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) with NULL params:
 *   30 0D 06 09 2A 86 48 86 F7 0D 01 01 01 05 00
 */
function wrapPkcs1AsPkcs8(pkcs1Der: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00]; // INTEGER 0
  const algIdentifier = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const octetStringHeader = [0x04, ...encodeLength(pkcs1Der.length)];
  const inner = [
    ...version,
    ...algIdentifier,
    ...octetStringHeader,
    ...pkcs1Der,
  ];
  const outer = [0x30, ...encodeLength(inner.length), ...inner];
  return new Uint8Array(outer);
}

export type PemConversionResult =
  | { ok: true; pem: string }
  | { ok: false; error: string };

/**
 * Converts a "BEGIN RSA PRIVATE KEY" (PKCS#1) PEM into a "BEGIN PRIVATE KEY"
 * (PKCS#8) PEM, entirely in the browser. Returns the new PEM string or an
 * error message.
 */
export function convertPkcs1ToPkcs8(pemRaw: string): PemConversionResult {
  const pem = (pemRaw ?? "").trim();
  if (!/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) {
    return { ok: false, error: "Not a PKCS#1 ('BEGIN RSA PRIVATE KEY') PEM." };
  }
  const body = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = decodeBase64(body);
  if (!der) return { ok: false, error: "Invalid base64 in PKCS#1 body." };
  const pkcs1 = new Uint8Array(der);
  const pkcs8 = wrapPkcs1AsPkcs8(pkcs1);
  const b64 = chunk(bytesToBase64(pkcs8), 64);
  return {
    ok: true,
    pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  };
}