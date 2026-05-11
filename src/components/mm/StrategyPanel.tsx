import { useBotStore } from "@/lib/store";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { restartTimerIfRunning } from "@/lib/scheduler/loop";
import { AlertTriangle } from "lucide-react";

function Row({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-sm text-primary">{format ? format(value) : value}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}

export function StrategyPanel() {
  const { strategy, setStrategy } = useBotStore();
  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">Strategy (Avellaneda–Stoikov)</h2>
      <Row label="γ (risk aversion)" value={strategy.gamma} min={0.05} max={3} step={0.05}
           onChange={(v) => setStrategy({ gamma: v })} format={(v) => v.toFixed(2)} />
      <Row label="σ (annualized vol)" value={strategy.sigmaAnnual} min={0.1} max={2} step={0.05}
           onChange={(v) => setStrategy({ sigmaAnnual: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
      <Row label="k (order-flow intensity)" value={strategy.k} min={0.1} max={10} step={0.1}
           onChange={(v) => setStrategy({ k: v })} format={(v) => v.toFixed(1)} />
      <Row label="Min edge (cents)" value={strategy.minEdgeCents} min={1} max={20} step={1}
           onChange={(v) => setStrategy({ minEdgeCents: v })} format={(v) => `${v}¢`} />
      <Row label="Ask / Bid ratio" value={strategy.askBidRatio} min={1} max={20} step={0.25}
           onChange={(v) => setStrategy({ askBidRatio: v })} format={(v) => `${v.toFixed(2)}×`} />
      <Row label="Max quote size" value={strategy.maxQuoteSize} min={1} max={100} step={1}
           onChange={(v) => setStrategy({ maxQuoteSize: v })} format={(v) => `${v}`} />
      <Row label="Tick interval (s)" value={strategy.tickIntervalMs / 1000} min={1} max={60} step={1}
           onChange={(v) => { setStrategy({ tickIntervalMs: v * 1000 }); restartTimerIfRunning(); }}
           format={(v) => `${v}s`} />
      <Row label="Max book age (s)" value={strategy.maxBookAgeSec} min={1} max={60} step={0.5}
           onChange={(v) => setStrategy({ maxBookAgeSec: v })}
           format={(v) => `${v}s`} />
    </div>
  );
}
