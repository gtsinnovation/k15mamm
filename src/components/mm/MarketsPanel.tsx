import { useBotStore } from "@/lib/store";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { KalshiClient } from "@/lib/kalshi/client";
import { toast } from "sonner";
import { useState } from "react";
import { RefreshCw, AlertTriangle, KeyRound, ShieldAlert, Inbox, CheckCircle2 } from "lucide-react";
import { runPreflight, type PreflightResult } from "@/lib/kalshi/preflight";

export function MarketsPanel() {
  const { markets, trackedTickers, toggleTicker, marketQuotes, positions, credentials, setMarkets, log } = useBotStore();
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<
    | { kind: "idle" }
    | { kind: "no-creds" }
    | { kind: "preflight"; result: PreflightResult }
    | { kind: "fetch-error"; message: string }
    | { kind: "empty-ok" }
  >({ kind: "idle" });

  const refresh = async () => {
    if (!credentials) {
      setDiagnostic({ kind: "no-creds" });
      toast.error("Save credentials first (Settings tab)");
      return;
    }
    setLoading(true);
    try {
      // Step 1: preflight (creds + proxy + signature)
      const pf = await runPreflight(credentials);
      if (pf.status !== "ok") {
        setDiagnostic({ kind: "preflight", result: pf });
        log("error", `preflight failed: ${pf.label} — ${pf.detail ?? ""}`);
        toast.error(`${pf.label}: ${pf.detail ?? ""}`);
        return;
      }
      // Step 2: actual fetch
      const client = new KalshiClient(credentials);
      const ms = await client.getBtc15MinMarkets();
      setMarkets(ms);
      log("info", `manual refresh: loaded ${ms.length} BTC 15-min markets`);
      if (ms.length === 0) {
        setDiagnostic({ kind: "empty-ok" });
        toast.warning("No BTC 15-min markets returned by Kalshi");
      } else {
        setDiagnostic({ kind: "idle" });
        toast.success(`Loaded ${ms.length} markets`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setDiagnostic({ kind: "fetch-error", message: msg });
      log("error", `manual refresh failed: ${msg}`);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-2 border-b border-border p-4">
        <div>
          <h2 className="text-lg font-semibold">BTC 15-minute markets</h2>
          <p className="text-xs text-muted-foreground">{markets.length} open · {trackedTickers.length} tracked</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>
      <ScrollArea className="h-[420px]">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">On</th>
              <th className="px-3 py-2 text-left">Ticker / Strike (≥)</th>
              <th className="px-3 py-2 text-right">Book</th>
              <th className="px-3 py-2 text-right">Our quote</th>
              <th className="px-3 py-2 text-right">FV</th>
              <th className="px-3 py-2 text-right">Pos</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const q = marketQuotes[m.ticker];
              const pos = positions[m.ticker]?.position ?? 0;
              const tracked = trackedTickers.includes(m.ticker);
              return (
                <tr key={m.ticker} className="border-t border-border/50 hover:bg-accent/30">
                  <td className="px-3 py-2"><Checkbox checked={tracked} onCheckedChange={() => toggleTicker(m.ticker)} /></td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{m.ticker}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.floor_strike != null && m.cap_strike != null
                        ? `$${m.floor_strike.toLocaleString()}–$${m.cap_strike.toLocaleString()}`
                        : m.floor_strike != null
                          ? `≥ $${m.floor_strike.toLocaleString()}`
                          : m.cap_strike != null
                            ? `≤ $${m.cap_strike.toLocaleString()}`
                            : "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    <span className="text-bid">{m.yes_bid}¢</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-ask">{m.yes_ask}¢</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {q ? (
                      <>
                        <span className="text-bid">{q.ourBid}¢</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-ask">{q.ourAsk}¢</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {q ? `${(q.fairValue * 100).toFixed(1)}¢` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{pos}</td>
                </tr>
              );
            })}
            {markets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8">
                  <EmptyDiagnostic
                    state={!credentials ? { kind: "no-creds" } : diagnostic}
                    loading={loading}
                    onRefresh={refresh}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyDiagnostic({
  state,
  loading,
  onRefresh,
}: {
  state:
    | { kind: "idle" }
    | { kind: "no-creds" }
    | { kind: "preflight"; result: PreflightResult }
    | { kind: "fetch-error"; message: string }
    | { kind: "empty-ok" };
  loading: boolean;
  onRefresh: () => void;
}) {
  let Icon = Inbox;
  let title = "No markets loaded";
  let detail = "Click Refresh to fetch BTC hourly markets from Kalshi.";
  let tone: "muted" | "warn" | "error" = "muted";

  if (state.kind === "no-creds") {
    Icon = KeyRound;
    tone = "warn";
    title = "Credentials missing";
    detail = "Open the Settings tab and paste your Kalshi API Key ID + RSA private key (PEM).";
  } else if (state.kind === "preflight") {
    const r = state.result;
    tone = "error";
    title = r.label;
    if (r.status === "proxy-blocked") {
      Icon = ShieldAlert;
      detail =
        (r.detail ?? "") +
        " Try a different CORS proxy in Settings (e.g. self-hosted Cloudflare Worker), or move the API call into a Lovable Cloud edge function.";
    } else if (r.status === "auth-failed") {
      Icon = KeyRound;
      detail = (r.detail ?? "") + " Double-check the API Key ID and that DEMO/PROD matches the key.";
    } else if (r.status === "signature-failed") {
      Icon = KeyRound;
      detail = (r.detail ?? "") + " Re-paste the PEM exactly as Kalshi gave it (including BEGIN/END lines).";
    } else {
      Icon = AlertTriangle;
      detail = r.detail ?? "Preflight check failed.";
    }
  } else if (state.kind === "fetch-error") {
    Icon = AlertTriangle;
    tone = "error";
    title = "Fetch failed after preflight passed";
    detail = `Kalshi returned an error on /markets: ${state.message}`;
  } else if (state.kind === "empty-ok") {
    Icon = CheckCircle2;
    tone = "warn";
    title = "Connected, but no hourly BTC markets are open";
    detail =
      "Kalshi has no open KXBTC hourly range markets right now (between cycles, or the series is paused). Try again in a few minutes.";
  }

  const toneClass =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warn"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-border bg-muted/30 text-muted-foreground";

  return (
    <div className={`mx-auto flex max-w-xl items-start gap-3 rounded-md border p-4 text-left ${toneClass}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="font-semibold">{title}</div>
        <div className="text-sm opacity-90">{detail}</div>
        <div>
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Retry"}
          </Button>
        </div>
      </div>
    </div>
  );
}
