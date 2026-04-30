import { useBotStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RiskPanel() {
  const { risk, setRisk } = useBotStore();
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">Risk limits</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Per-market position cap</Label>
          <Input type="number" value={risk.perMarketPositionCap}
                 onChange={(e) => setRisk({ perMarketPositionCap: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Global $ exposure cap</Label>
          <Input type="number" value={risk.globalDollarExposureCap}
                 onChange={(e) => setRisk({ globalDollarExposureCap: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Daily stop-loss ($)</Label>
          <Input type="number" value={risk.dailyStopLossDollars}
                 onChange={(e) => setRisk({ dailyStopLossDollars: Number(e.target.value) })} />
        </div>
        <div className="flex items-end gap-2">
          <input type="checkbox" id="autoflat" checked={risk.autoFlattenOnStop}
                 onChange={(e) => setRisk({ autoFlattenOnStop: e.target.checked })}
                 className="h-4 w-4" />
          <Label htmlFor="autoflat" className="text-xs">Auto-flatten on stop</Label>
        </div>
      </div>
    </div>
  );
}
