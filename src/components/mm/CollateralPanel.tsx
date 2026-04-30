import { useState } from "react";
import { useBotStore } from "@/lib/store";
import { liveReservedFromQuotes } from "@/lib/strategy/collateral";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Wallet, Lock, Coins, Activity, Scale, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CollateralPanel() {
  const balance = useBotStore((s) => s.balance);
  const marketQuotes = useBotStore((s) => s.marketQuotes);
  const trackedTickers = useBotStore((s) => s.trackedTickers);
  const positions = useBotStore((s) => s.positions);
  const size = useBotStore((s) => s.strategy.maxQuoteSize);
  const actualReserved = useBotStore((s) => s.actualReserved);
  const [showExpected, setShowExpected] = useState(false);

  const { perMarket, totalCents } = liveReservedFromQuotes(
    marketQuotes,
    trackedTickers,
    positions,
    size
  );

  const reservedDollars = totalCents / 100;
  const expectedTotalCents = perMarket.reduce((acc, r) => acc + r.totalExpectedCents, 0);
  const expectedDollars = expectedTotalCents / 100;
  const actualDollars = (actualReserved?.totalCents ?? 0) / 100;
  // Kalshi `balance` = available cash. Total equity ≈ available + actually reserved.
  const totalEquity = balance + actualDollars;
  const utilization = totalEquity > 0 ? (actualDollars / totalEquity) * 100 : 0;
  const deltaCents = totalCents - (actualReserved?.totalCents ?? 0);
  const deltaDollars = deltaCents / 100;
  const deltaSign = deltaCents > 0 ? "+" : deltaCents < 0 ? "−" : "±";

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div>
          <h2 className="text-lg font-semibold">Collateral & balance</h2>
          <p className="text-xs text-muted-foreground">
            Estimated vs. actual reserved cash from Kalshi's open-orders snapshot
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="show-expected"
              checked={showExpected}
              onCheckedChange={setShowExpected}
            />
            <Label htmlFor="show-expected" className="text-xs">
              Show expected (prob-weighted)
            </Label>
          </div>
          {actualReserved && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              synced {Math.max(0, Math.round((Date.now() - actualReserved.ts) / 1000))}s ago ·{" "}
              {actualReserved.orderCount} resting
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-6">
        <Stat
          icon={<Wallet className="h-4 w-4" />}
          label="Available balance"
          value={`$${balance.toFixed(2)}`}
          tone="default"
        />
        <Stat
          icon={<Lock className="h-4 w-4" />}
          label="Worst-case reserved"
          value={`$${reservedDollars.toFixed(2)}`}
          tone={reservedDollars > 0 ? "warn" : "muted"}
        />
        <Stat
          icon={<TrendingDown className="h-4 w-4" />}
          label="Expected at risk"
          value={`$${expectedDollars.toFixed(2)}`}
          tone={expectedDollars > 0 ? "warn" : "muted"}
        />
        <Stat
          icon={<Activity className="h-4 w-4" />}
          label="Actual reserved"
          value={actualReserved ? `$${actualDollars.toFixed(2)}` : "—"}
          tone={actualDollars > 0 ? "warn" : "muted"}
        />
        <Stat
          icon={<Scale className="h-4 w-4" />}
          label="Δ est − actual"
          value={
            actualReserved
              ? `${deltaSign}$${Math.abs(deltaDollars).toFixed(2)}`
              : "—"
          }
          tone={Math.abs(deltaDollars) > 1 ? "warn" : "muted"}
        />
        <Stat
          icon={<Coins className="h-4 w-4" />}
          label="Utilization"
          value={`${utilization.toFixed(1)}%`}
          tone={utilization > 80 ? "danger" : utilization > 50 ? "warn" : "muted"}
        />
      </div>
      <div className="border-t border-border">
        <ScrollArea className="h-[220px]">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Ticker</th>
                <th className="px-3 py-2 text-right">Bid × size</th>
                <th className="px-3 py-2 text-right">Ask × size</th>
                <th className="px-3 py-2 text-right">Bid coll.</th>
                <th className="px-3 py-2 text-right">Ask coll.</th>
                <th className="px-3 py-2 text-right">
                  {showExpected ? "Expected total" : "Worst-case"}
                </th>
                <th className="px-3 py-2 text-right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {perMarket.map((r) => {
                const actualForTicker = actualReserved?.perTicker[r.ticker];
                const bidShown = showExpected ? r.bidExpectedCents : r.bidReservedCents;
                const askShown = showExpected ? r.askExpectedCents : r.askReservedCents;
                const totalShown = showExpected ? r.totalExpectedCents : r.totalReservedCents;
                return (
                  <tr key={r.ticker} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">{r.ticker}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      <span className="text-bid">{r.bidCents}¢</span> × {r.size}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      <span className="text-ask">{r.askCents}¢</span> × {r.size}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtUsd(bidShown)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtUsd(askShown)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                      {fmtUsd(totalShown)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {actualForTicker != null ? (
                        <span className="text-warning">{fmtUsd(actualForTicker)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {perMarket.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No live quotes yet. Reserved collateral will appear here when the bot starts quoting tracked markets.
                  </td>
                </tr>
              )}
            </tbody>
            {perMarket.length > 0 && (
              <tfoot className="sticky bottom-0 bg-card">
                <tr className="border-t border-border">
                  <td className="px-3 py-2 text-xs font-semibold uppercase text-muted-foreground" colSpan={5}>
                    {showExpected ? "Totals (expected)" : "Totals (worst-case)"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-bold text-warning">
                    {fmtUsd(showExpected ? expectedTotalCents : totalCents)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-sm font-bold text-warning">
                    {actualReserved ? fmtUsd(actualReserved.totalCents) : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "default" | "muted" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warn"
      ? "text-warning"
      : tone === "muted"
      ? "text-muted-foreground"
      : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn("mt-1 font-mono text-lg font-semibold", toneClass)}>{value}</div>
    </div>
  );
}
