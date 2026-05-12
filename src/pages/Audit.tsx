import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
