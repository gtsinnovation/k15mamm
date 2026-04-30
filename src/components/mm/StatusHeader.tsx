import { useEffect, useState } from "react";
import { useBotStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusHeader() {
  const { runState, balance, btcSpot, lastTickAt, pnlHistory, sessionStartEquity } =
    useBotStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const lastEquity = pnlHistory[pnlHistory.length - 1]?.equity ?? balance;
  const dayPnl = sessionStartEquity > 0 ? lastEquity - sessionStartEquity : 0;
  const heartbeatAge = lastTickAt ? (now - lastTickAt) / 1000 : Infinity;
  const heartbeatHealthy = heartbeatAge < 30;

  const stateColors: Record<typeof runState, string> = {
    idle: "bg-muted text-muted-foreground",
    running: "bg-success text-success-foreground",
    paused: "bg-warning text-warning-foreground",
    killed: "bg-destructive text-destructive-foreground",
  };
  const env = useBotStore((s) => s.credentials?.env);
  const envLabel = env === "prod" ? "PROD" : "DEMO";
  const envClass = env === "prod" ? "border-destructive text-destructive" : "border-warning text-warning";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn("h-3 w-3 rounded-full", heartbeatHealthy && runState === "running" ? "bg-success animate-pulse" : "bg-destructive")} />
        <Badge className={cn("uppercase tracking-wide", stateColors[runState])}>{runState}</Badge>
        <Badge variant="outline" className={envClass}>{envLabel}</Badge>
      </div>
      <Stat label="BTC Spot" value={btcSpot ? `$${btcSpot.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />
      <Stat label="Balance" value={`$${balance.toFixed(2)}`} />
      <Stat label="Day P&L" value={`${dayPnl >= 0 ? "+" : ""}$${dayPnl.toFixed(2)}`} className={dayPnl >= 0 ? "text-success" : "text-destructive"} />
      <Stat label="Heartbeat" value={lastTickAt ? `${heartbeatAge.toFixed(0)}s ago` : "never"} className={heartbeatHealthy ? "text-success" : "text-destructive"} />
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-sm font-semibold", className)}>{value}</span>
    </div>
  );
}
