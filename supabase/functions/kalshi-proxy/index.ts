// Kalshi CORS proxy. The browser signs the request (keeping the RSA PEM
// client-side) and forwards it here; we just relay to Kalshi and pipe the
// response back. No secrets stored server-side.
//
// Access control: every request must carry a valid Lovable Cloud (Supabase)
// session JWT for the single allowlisted Google account. Anyone else — even
// with valid Kalshi credentials — gets 403 before we ever hit Kalshi.
// NOTE: This function MUST run with `verify_jwt = false` in supabase/config.toml
// because we validate the JWT in code (using supabase.auth.getUser), and the
// gateway-level JWT check is incompatible with the new asymmetric signing-key
// JWTs issued via Google OAuth on Lovable Cloud.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALLOWED_EMAIL = "gbsahn@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, kalshi-access-key, kalshi-access-signature, kalshi-access-timestamp",
  "Access-Control-Max-Age": "86400",
};

const BASE: Record<string, string> = {
  demo: "https://demo-api.kalshi.co",
  prod: "https://api.elections.kalshi.com",
};

const FORWARD_HEADERS = [
  "kalshi-access-key",
  "kalshi-access-signature",
  "kalshi-access-timestamp",
  "content-type",
];

function jsonError(status: number, message: string, code?: string) {
  return new Response(
    JSON.stringify({ error: { code: code ?? "error", message } }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Auth gate: require a logged-in Lovable Cloud user whose email
    // matches the allowlisted Google account. ----
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonError(401, "Missing bearer token", "unauthorized");
    }
    const token = authHeader.slice(7).trim();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return jsonError(500, "Server misconfigured", "server_error");
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    // Prefer getClaims() — it validates the JWT locally via JWKS and works
    // with the new asymmetric signing keys (ES256). Fall back to getUser()
    // for legacy HS256 tokens.
    let email = "";
    try {
      const { data: claimsRes, error: claimsErr } = await supabase.auth.getClaims(token);
      if (claimsErr) throw claimsErr;
      email = String(claimsRes?.claims?.email ?? "").toLowerCase();
    } catch {
      const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userRes?.user) {
        return jsonError(401, "Invalid or expired session", "unauthorized");
      }
      email = (userRes.user.email ?? "").toLowerCase();
    }
    if (email !== ALLOWED_EMAIL.toLowerCase()) {
      return jsonError(
        403,
        "Account not authorized for trade API access",
        "forbidden",
      );
    }

    const url = new URL(req.url);
    const env = (url.searchParams.get("env") ?? "demo").toLowerCase();
    const target = url.searchParams.get("path");
    const base = BASE[env];
    if (!base || !target || !target.startsWith("/trade-api/")) {
      return jsonError(400, "Missing or invalid 'env' / 'path' query params", "bad_request");
    }

    const headers = new Headers();
    for (const name of FORWARD_HEADERS) {
      const v = req.headers.get(name);
      if (v) headers.set(name, v);
    }

    const init: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.text();
    }

    const upstream = await fetch(`${base}${target}`, init);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: `proxy: ${msg}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});