import { useBotStore } from "@/lib/store";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export function PnlChart() {
  const { pnlHistory, sessionStartEquity } = useBotStore();
  const data = pnlHistory.map((p) => ({
    t: new Date(p.ts).toLocaleTimeString(),
    pnl: sessionStartEquity > 0 ? p.equity - sessionStartEquity : 0,
  }));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-lg font-semibold">Session P&L</h2>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
              formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
            />
            <Line type="monotone" dataKey="pnl" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        {data.length === 0 && (
          <div className="-mt-[200px] flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            No P&L data yet — start the bot.
          </div>
        )}
      </div>
    </div>
  );
}
