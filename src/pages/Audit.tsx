import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Trash2,
  ScrollText,
  AlertTriangle,
  Info,
  ShieldAlert,
  Activity,
  CheckCircle2,
} from "lucide-react";
import {
  exportAuditLog,
  clearAuditLog,
  downloadAuditLog,
  exportTickerMismatches,
  clearTickerMismatches,
  type TickerMismatchEntry,
} from "@/lib/audit/logStore";
import type { LogEntry, LogLevel } from "@/lib/store";
import { useBotStore } from "@/lib/store";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Per-user audit log viewer. The store mirrors every quote, fill, cancel,
 * and error to the local IndexedDB audit store; this page reads those rows
 * back and provides filters, free-text search, and CSV / JSON export.
 *
 * "Per user" = scoped to the signed-in account on this device. We surface
 * the user's email so they can confirm whose history they're looking at,
 * but storage is local-only by design (your Kalshi private key never
 * leaves the browser, so neither should the trail it produced).
 */
export default function Audit() {
  const [rows, setRows] = useState<LogEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [ticker, setTicker] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [email, setEmail] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mismatches, setMismatches] = useState<TickerMismatchEntry[]>([]);
  const liveMismatches = useBotStore((s) => s.tickerMismatches);

  const reload = async () => {
    setRefreshing(true);
    try {
      const [all, mm] = await Promise.all([exportAuditLog(), exportTickerMismatches()]);
      all.sort((a, b) => b.ts - a.ts);
      mm.sort((a, b) => b.ts - a.ts);
      setRows(all);
      setMismatches(mm);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void reload();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email ?? null);
    });
  }, []);

  const tickers = useMemo(() => {
    if (!rows) return [] as string[];
    const set = new Set<string>();
    for (const r of rows) if (r.ticker) set.add(r.ticker);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const fromMs = from ? new Date(from).getTime() : 0;
    const toMs = to ? new Date(to).getTime() : Number.POSITIVE_INFINITY;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (level !== "all" && r.level !== level) return false;
      if (ticker !== "all" && r.ticker !== ticker) return false;
      if (r.ts < fromMs || r.ts > toMs) return false;
      if (q && !`${r.msg} ${r.ticker ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, level, ticker, from, to, search]);

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = {
      info: 0,
      warn: 0,
      error: 0,
      quote: 0,
      fill: 0,
    };
    for (const r of filtered) c[r.level] = (c[r.level] ?? 0) + 1;
    return c;
  }, [filtered]);

  const downloadCsv = () => {
    if (filtered.length === 0) {
      toast.warning("Nothing to export with the current filters");
      return;
    }
    const header = ["timestamp_iso", "timestamp_ms", "level", "ticker", "message"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          new Date(r.ts).toISOString(),
          String(r.ts),
          r.level,
          r.ticker ?? "",
          escape(r.msg),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `k15m-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${filtered.length} row${filtered.length === 1 ? "" : "s"}`);
  };

  const downloadJson = async () => {
    const n = await downloadAuditLog();
    toast.success(`Exported ${n} row${n === 1 ? "" : "s"}`);
  };

  const clearAll = async () => {
    if (
      !confirm(
        `Permanently delete ${rows?.length ?? 0} audit log rows from this browser? This cannot be undone.`,
      )
    ) {
      return;
    }
    await clearAuditLog();
    await reload();
    toast.success("Audit log cleared");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>Audit Log — K15M AMM</title>
        <meta
          name="description"
          content="Per-user local audit trail for K15M AMM: quotes, fills, cancels, errors, and ticker mismatches with CSV/JSON export."
        />
        <link rel="canonical" href="https://k15mamm.webpwa.io/audit" />
        <meta property="og:title" content="Audit Log — K15M AMM" />
        <meta property="og:description" content="Local activity log of every quote, fill, cancel, and error from the K15M bot." />
        <meta property="og:url" content="https://k15mamm.webpwa.io/audit" />
      </Helmet>
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Audit log</h1>
              <p className="text-xs text-muted-foreground">
                Every quote, fill, cancel, and error placed by the bot
                {email && (
                  <>
                    {" "}for <span className="font-mono text-foreground">{email}</span>
                  </>
                )}
                . Stored locally on this device.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
            </Link>
          </Button>
        </div>
      </header>

      <main className="container space-y-4 py-6">
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-5">
          <CountBadge label="Info" count={counts.info} icon={Info} tone="muted" />
          <CountBadge label="Quote" count={counts.quote} icon={Activity} tone="info" />
          <CountBadge label="Fill" count={counts.fill} icon={CheckCircle2} tone="success" />
          <CountBadge label="Warn" count={counts.warn} icon={ShieldAlert} tone="warn" />
          <CountBadge label="Error" count={counts.error} icon={AlertTriangle} tone="error" />
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search message or ticker…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Level</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as LogLevel | "all")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="quote">Quote</SelectItem>
                  <SelectItem value="fill">Fill</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ticker</Label>
              <Select value={ticker} onValueChange={setTicker}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tickers</SelectItem>
                  {tickers.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 md:col-span-1">
              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input
                  type="datetime-local"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">To</Label>
                <Input
                  type="datetime-local"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-mono text-foreground">{filtered.length}</span> of{" "}
              <span className="font-mono text-foreground">{rows?.length ?? 0}</span> entries
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={reload} disabled={refreshing}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={downloadCsv}>
                <Download className="mr-2 h-3.5 w-3.5" /> Export CSV
              </Button>
              <Button size="sm" variant="outline" onClick={downloadJson}>
                <Download className="mr-2 h-3.5 w-3.5" /> Export JSON
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearAll}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          </div>
        </div>

        <TickerMismatchPanel
          persisted={mismatches}
          live={liveMismatches}
          onCleared={() => {
            setMismatches([]);
            useBotStore.getState().clearTickerMismatchStream();
          }}
        />

        <div className="rounded-lg border border-border bg-card">
          <ScrollArea className="h-[60vh]">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Level</th>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows == null ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-12 text-center text-sm text-muted-foreground">
                      Loading audit log…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-12 text-center text-sm text-muted-foreground">
                      {rows.length === 0
                        ? "No audit entries yet. Start the bot to begin recording."
                        : "No entries match the current filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr key={`${r.ts}-${i}`} className="border-t border-border/50 hover:bg-accent/30">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                        {new Date(r.ts).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <LevelBadge level={r.level} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.ticker ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.msg}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </main>
    </div>
  );
}

function LevelBadge({ level }: { level: LogLevel }) {
  const style: Record<LogLevel, string> = {
    info: "bg-muted text-muted-foreground",
    quote: "bg-primary/15 text-primary",
    fill: "bg-success/15 text-success",
    warn: "bg-warning/15 text-warning",
    error: "bg-destructive/15 text-destructive",
  };
  return (
    <Badge variant="outline" className={`border-transparent px-2 py-0.5 text-[10px] uppercase ${style[level]}`}>
      {level}
    </Badge>
  );
}

function CountBadge({
  label,
  count,
  icon: Icon,
  tone,
}: {
  label: string;
  count: number;
  icon: typeof Info;
  tone: "muted" | "info" | "success" | "warn" | "error";
}) {
  const cls =
    tone === "error"
      ? "border-destructive/30 text-destructive"
      : tone === "warn"
        ? "border-warning/30 text-warning"
        : tone === "success"
          ? "border-success/30 text-success"
          : tone === "info"
            ? "border-primary/30 text-primary"
            : "border-border text-muted-foreground";
  return (
    <div className={`flex items-center gap-2 rounded-md border ${cls} bg-background/40 p-2`}>
      <Icon className="h-4 w-4" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
        <div className="font-mono text-sm">{count}</div>
      </div>
    </div>
  );
}

function TickerMismatchPanel({
  persisted,
  live,
  onCleared,
}: {
  persisted: TickerMismatchEntry[];
  live: TickerMismatchEntry[];
  onCleared: () => void;
}) {
  // Merge live + persisted, dedup by (tradeId, orderId, ts), newest first.
  const merged = useMemo(() => {
    const map = new Map<string, TickerMismatchEntry>();
    for (const e of [...live, ...persisted]) {
      map.set(`${e.tradeId}|${e.orderId}|${e.ts}`, e);
    }
    return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
  }, [live, persisted]);

  const download = (fmt: "json" | "csv") => {
    if (merged.length === 0) {
      toast.warning("No ticker-mismatch entries to export");
      return;
    }
    let blob: Blob;
    let ext: string;
    if (fmt === "json") {
      blob = new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" });
      ext = "json";
    } else {
      const header = ["timestamp_iso", "timestamp_ms", "kind", "order_id", "trade_id", "fill_ticker", "expected_ticker"];
      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const lines = [header.join(",")];
      for (const e of merged) {
        lines.push(
          [
            new Date(e.ts).toISOString(),
            String(e.ts),
            e.kind,
            e.orderId,
            e.tradeId,
            esc(e.fillTicker ?? ""),
            esc(e.expectedTicker ?? ""),
          ].join(","),
        );
      }
      blob = new Blob([lines.join("\n")], { type: "text/csv" });
      ext = "csv";
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `k15m-ticker-mismatches-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${merged.length} mismatch${merged.length === 1 ? "" : "es"}`);
  };

  const clear = async () => {
    if (!confirm(`Delete all ${merged.length} ticker-mismatch entries from this browser?`)) return;
    await clearTickerMismatches();
    onCleared();
    toast.success("Ticker mismatches cleared");
  };

  return (
    <div className="rounded-lg border border-warning/30 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          <div>
            <div className="text-sm font-semibold">Ticker mismatches</div>
            <div className="text-[11px] text-muted-foreground">
              Structured audit stream of fill → order ticker reconciliation events.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{merged.length}</span>
          <Button size="sm" variant="outline" onClick={() => download("csv")}>
            <Download className="mr-2 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => download("json")}>
            <Download className="mr-2 h-3.5 w-3.5" /> JSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clear}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </div>
      {merged.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No ticker mismatches recorded. Fills are reconciling cleanly against the order ledger.
        </div>
      ) : (
        <ScrollArea className="max-h-64">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="sticky top-0 bg-card text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Order ID</th>
                <th className="px-3 py-2 text-left">Trade ID</th>
                <th className="px-3 py-2 text-left">Fill ticker</th>
                <th className="px-3 py-2 text-left">Expected ticker</th>
              </tr>
            </thead>
            <tbody>
              {merged.slice(0, 50).map((e) => (
                <tr key={`${e.tradeId}-${e.orderId}-${e.ts}`} className="border-t border-border/50">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">
                    {new Date(e.ts).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge
                      variant="outline"
                      className={
                        e.kind === "unresolved"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-warning/30 bg-warning/10 text-warning"
                      }
                    >
                      {e.kind}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 font-mono" title={e.orderId}>{e.orderId.slice(0, 8)}…</td>
                  <td className="px-3 py-1.5 font-mono" title={e.tradeId}>{e.tradeId.slice(0, 8)}…</td>
                  <td className="px-3 py-1.5 font-mono">{e.fillTicker ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{e.expectedTicker ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </div>
  );
}
