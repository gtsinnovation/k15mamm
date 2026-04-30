import { useBotStore } from "@/lib/store";

/**
 * One-time migration for users who saved plaintext credentials before the
 * vault existed. We intentionally do NOT auto-encrypt with a default
 * passphrase — instead we surface the legacy creds so the unlock gate can
 * ask the user to set a passphrase, then we wipe the plaintext blob.
 *
 * Returns the legacy plaintext credentials if found, otherwise null.
 */
export interface LegacyPlainCreds {
  keyId: string;
  privateKeyPem: string;
  env: "demo" | "prod";
  corsProxy: string;
}

const STORE_KEY = "kalshi-mm-store";

export function readAndClearLegacyCreds(): LegacyPlainCreds | null {
  // Only run if no encrypted vault exists yet — otherwise we'd clobber it.
  if (useBotStore.getState().encryptedCredentials) return null;
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: { credentials?: LegacyPlainCreds | null } };
    const c = parsed?.state?.credentials;
    if (!c || !c.privateKeyPem) return null;
    // Strip the plaintext credentials from the persisted blob immediately.
    if (parsed.state) {
      delete parsed.state.credentials;
      localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
    }
    return c;
  } catch {
    return null;
  }
}