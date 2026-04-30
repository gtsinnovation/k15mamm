import { KalshiClient } from "./client";
import type { KalshiCredentials } from "./types";
import { validatePem } from "./pem";

export type PreflightStatus =
  | "idle"
  | "checking"
  | "ok"
  | "no-credentials"
  | "proxy-blocked"
  | "signature-failed"
  | "auth-failed"
  | "network-error"
  | "unknown-error";

export interface PreflightResult {
  status: PreflightStatus;
  label: string;
  detail?: string;
  balanceCents?: number;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message?.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const maybeMessage = Reflect.get(error, "message");
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage.trim();
    const maybeName = Reflect.get(error, "name");
    if (typeof maybeName === "string" && maybeName.trim()) return maybeName.trim();
  }
  return "Unknown error";
}

/**
 * Runs a low-impact GET to validate credentials, signing, and the CORS proxy
 * end-to-end. Classifies failures so the UI can show an actionable badge.
 */
export async function runPreflight(
  creds: KalshiCredentials | null
): Promise<PreflightResult> {
  if (!creds || !creds.keyId.trim() || !creds.privateKeyPem.trim()) {
    return { status: "no-credentials", label: "No credentials" };
  }
  // Validate the PEM locally first — gives a precise error before any network call.
  const pem = await validatePem(creds.privateKeyPem);
  if (!pem.ok) {
    return {
      status: "signature-failed",
      label: pem.label,
      detail: pem.detail,
    };
  }
  const client = new KalshiClient(creds);
  try {
    const bal = await client.getBalance();
    return {
      status: "ok",
      label: "Credentials OK",
      detail: `balance $${(bal.balance / 100).toFixed(2)}`,
      balanceCents: bal.balance,
    };
  } catch (e) {
    const msg = getErrorMessage(e);
    const lower = msg.toLowerCase();

    if (
      lower.includes("invalid keydata") ||
      lower.includes("pkcs8") ||
      lower.includes("importkey") ||
      lower.includes("dataerror") ||
      lower.includes("operationerror")
    ) {
      return {
        status: "signature-failed",
        label: "Invalid PEM format",
        detail:
          "The RSA private key could not be imported by WebCrypto. Re-paste the full PKCS#8 PEM including the BEGIN/END lines, and make sure it matches the API Key ID.",
      };
    }

    // Network / CORS proxy reachability — fetch throws TypeError before any HTTP status.
    if (
      e instanceof TypeError ||
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("load failed")
    ) {
      return {
        status: "proxy-blocked",
        label: "Proxy blocked",
        detail:
          "Browser couldn't reach the CORS proxy. Check the proxy URL in Settings or self-host one.",
      };
    }

    // Signature / auth — Kalshi returns 401/403 with messages mentioning signature or unauthorized.
    // It also returns 401 with `authentication_error / NOT_FOUND` when the API Key ID does not exist
    // in the selected environment (e.g. prod key used on demo or vice-versa).
    if (
      lower.includes("→ 401") ||
      lower.includes("unauthorized") ||
      lower.includes("invalid api key") ||
      lower.includes("authentication_error") ||
      (lower.includes("not_found") && lower.includes("authentication"))
    ) {
      return {
        status: "auth-failed",
        label: "Auth failed",
        detail:
          "Kalshi rejected the API Key ID. Most common cause: the key was created in the OTHER environment (prod key used on DEMO, or demo key used on PROD). Flip the Environment switch in Settings, or create a key in the correct env.",
      };
    }
    if (
      lower.includes("signature") ||
      lower.includes("→ 403") ||
      lower.includes("forbidden")
    ) {
      return {
        status: "signature-failed",
        label: "Signature failed",
        detail:
          "Kalshi rejected the request signature. Verify the RSA private key (PEM) matches the API Key ID.",
      };
    }

    // Proxy itself returned an HTTP error (e.g. 502 from corsproxy.io).
    if (/→ 5\d\d/.test(msg) || lower.includes("bad gateway") || lower.includes("gateway timeout")) {
      return {
        status: "proxy-blocked",
        label: "Proxy blocked",
        detail: `Proxy returned an error: ${msg}`,
      };
    }

    return {
      status: "unknown-error",
      label: "Preflight failed",
      detail: msg === "Unknown error" ? "Kalshi or the browser rejected the request without a readable error message." : msg,
    };
  }
}

export const PREFLIGHT_BADGE_CLASS: Record<PreflightStatus, string> = {
  idle: "bg-muted text-muted-foreground border-border",
  checking: "bg-muted text-muted-foreground border-border animate-pulse",
  ok: "bg-success/15 text-success border-success/40",
  "no-credentials": "bg-warning/15 text-warning border-warning/40",
  "proxy-blocked": "bg-destructive/15 text-destructive border-destructive/40",
  "signature-failed": "bg-destructive/15 text-destructive border-destructive/40",
  "auth-failed": "bg-destructive/15 text-destructive border-destructive/40",
  "network-error": "bg-destructive/15 text-destructive border-destructive/40",
  "unknown-error": "bg-destructive/15 text-destructive border-destructive/40",
};