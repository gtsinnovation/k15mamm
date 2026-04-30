import { useMemo, useState } from "react";
import { useBotStore, type OrderLedgerEntry, type OrderLedgerStatus } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ListOrdered } from "lucide-react";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

const STATUS_STYLES: Record<OrderLedgerStatus, string> = {
  resting: "bg-primary/15 text-primary border-primary/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  filled: "bg-success/15 text-success border-success/30",
  expired: "bg-warning/15 text-warning border-warning/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

type Filter = "all" | "resting" | "closed";

export function OrderLedgerPanel() {
  const ledger = useBotStore((s) => s.orderLedger);
  const clearOrderLedger = useBotStore((s) => s.clearOrderLedger);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "resting") return ledger.filter((e) => e.status === "resting");
    if (filter === "closed") return ledger.filter((e) => e.status !== "resting");
    return ledger;
  }, [ledger, filter]);

  const totals = useMemo(() => {
    let resting = 0;
    let released = 0;
    let restingCount = 0;
    let filledCount = 0;
    let cancelledCount = 0;
    for (const e of ledger) {
      if (e.status === "resting") {
        resting += e.reservedCents;
        restingCount += 1;
      } else {
        released += e.releasedCents;
        if (e.status === "filled") filledCount += 1;
        if (e.status === "cancelled") cancelledCount += 1;
      }
    }
    return { resting, released, restingCount, filledCount, cancelledCount };
  }, [ledger]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Order ledger</h2>
            <p className="text-xs text-muted-foreground">
              Each placed order linked to the collateral reserved at placement and released on cancel/fill
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FilterButton current={filter} value="all" onClick={setFilter}>
            All ({ledger.length})
          </FilterButton>
          <FilterButton current={filter} value="resting" onClick={setFilter}>
            Resting ({totals.restingCount})
          </FilterButton>
          <FilterButton current={filter} value="closed" onClick={setFilter}>
            Closed ({totals.filledCount + totals.cancelledCount})
          </FilterButton>
          <Button variant="ghost" size="sm" onClick={clearOrderLedger}>
            Clear
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Mini label="Resting reserved" value={fmtUsd(totals.resting)} tone="warn" />
        <Mini label="Released (lifetime)" value={fmtUsd(totals.released)} tone="success" />
        <Mini label="Filled" value={String(totals.filledCount)} tone="success" />
        <Mini label="Cancelled" value={String(totals.cancelledCount)} tone="muted" />
      </div>
      <ScrollArea className="h-[280px] border-t border-border">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Ticker</th>
              <th className="px-3 py-2 text-left">Side</th>
              <th className="px-3 py-2 text-right">Price × n</th>
              <th className="px-3 py-2 text-right">Reserved</th>
              <th className="px-3 py-2 text-right">Released</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Order ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No orders yet. Placed orders will appear here with their per-order collateral.
                </td>
              </tr>
            )}
            {filtered.map((e) => (
              <OrderRow key={e.orderId} entry={e} />
            ))}
          </tbody>
        </table>
        </div>
      </ScrollArea>
    </div>
  );
}

function OrderRow({ entry: e }: { entry: OrderLedgerEntry }) {
  return (
    <tr className="border-t border-border/50">
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{fmtTime(e.placedAt)}</td>
      <td className="px-3 py-2 font-mono text-xs">{e.ticker}</td>
      <td className="px-3 py-2 text-xs">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono uppercase",
            e.side === "bid" ? "bg-bid/10 text-bid" : "bg-ask/10 text-ask"
          )}
        >
          {e.side}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {e.priceCents}¢ × {e.size}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs text-warning">
        {fmtUsd(e.reservedCents)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {e.releasedCents > 0 ? (
          <span className="text-success">{fmtUsd(e.releasedCents)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant="outline" className={cn("uppercase", STATUS_STYLES[e.status])}>
          {e.status}
        </Badge>
        {e.closedAt && (
          <span className="ml-1 text-[10px] text-muted-foreground">{fmtTime(e.closedAt)}</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground" title={e.orderId}>
        {e.orderId.slice(0, 8)}…
      </td>
    </tr>
  );
}

function FilterButton({
  current,
  value,
  onClick,
  children,
}: {
  current: Filter;
  value: Filter;
  onClick: (v: Filter) => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={current === value ? "secondary" : "ghost"}
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => onClick(value)}
    >
      {children}
    </Button>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "warn" | "success" | "muted";
}) {
  const toneClass =
    tone === "warn"
      ? "text-warning"
      : tone === "success"
      ? "text-success"
      : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-base font-semibold", toneClass)}>{value}</div>
    </div>
  );
}