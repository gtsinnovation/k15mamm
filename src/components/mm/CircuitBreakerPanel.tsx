import { useState } from "react";
import { useBotStore } from "@/lib/store";
import { rearm } from "@/lib/scheduler/loop";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Activity, ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Read-only status panel for the rolling 60-second loss circuit breaker.
 *
 * Shows:
 *  - The configured limit ($) and live drop ($) measured in the last 60s.
 *  - The exact reason and timestamp of the most recent trip (if any).
 *  - A manual "Re-arm bot after stop" button that ONLY appears once a trip
 *    has occurred. The button opens a confirmation dialog that surfaces the
 *    current risk caps so the user has to acknowledge them before the
 *    scheduler is allowed to start again.
 */
export function CircuitBreakerPanel() {
  const trip = useBotStore((s) => s.circuitBreakerTrip);
  const dropNow = useBotStore((s) => s.lastMinuteDropDollars);
  const limit = useBotStore((s) => s.risk.maxLossPerMinuteDollars);
  const risk = useBotStore((s) => s.risk);
  const runState = useBotStore((s) => s.runState);
  const [confirmed, setConfirmed] = useState(false);

  const hasTrip = !!trip && !trip.acknowledgedAt;
  const armed = limit > 0;
  const pct = limit > 0 ? Math.min(100, (dropNow / limit) * 100) : 0;
  const barColor =
    pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-warning" : "bg-success";

  const handleRearm = () => {
    rearm();
    setConfirmed(false);
    toast.success("Bot re-armed", {
      description: "Press Start to resume trading.",
    });
  };

  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${
        hasTrip
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {hasTrip ? (
            <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
          ) : armed ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 text-success" />
          ) : (
            <Activity className="mt-0.5 h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <h3 className="text-sm font-semibold">Circuit breaker</h3>
            <p className="text-xs text-muted-foreground">
              Rolling 60-second max-loss kill switch.{" "}
              {armed ? (
                <>Limit: <span className="font-mono text-foreground">${limit.toFixed(2)}</span></>
              ) : (
                "Disabled (set max loss / 60s in Risk panel)."
              )}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
            hasTrip
              ? "bg-destructive/15 text-destructive"
              : armed
              ? "bg-success/15 text-success"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {hasTrip ? "Tripped" : armed ? "Armed" : "Off"}
        </span>
      </div>

      {armed && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Last 60s drop</span>
            <span className="font-mono text-foreground">
              ${dropNow.toFixed(2)} / ${limit.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className={`h-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {trip && (
        <div className="space-y-1 rounded-md border border-border bg-background/40 p-2.5 text-xs">
          <div className="font-semibold text-destructive">
            Last trip — {new Date(trip.ts).toLocaleString()}
          </div>
          <div className="text-foreground">{trip.reason}</div>
          {trip.equityAtTrip != null && (
            <div className="text-muted-foreground">
              Equity at trip:{" "}
              <span className="font-mono text-foreground">
                ${trip.equityAtTrip.toFixed(2)}
              </span>
            </div>
          )}
          {trip.acknowledgedAt && (
            <div className="text-success">
              Re-armed at {new Date(trip.acknowledgedAt).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}

      {hasTrip && runState !== "running" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="default" size="sm" className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" /> Re-arm bot after stop
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" />
                Confirm risk limits before re-arming
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    The circuit breaker tripped because: <em>{trip?.reason}</em>
                  </p>
                  <p>Confirm your current limits before resuming:</p>
                  <ul className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs font-mono">
                    <li>Max loss / 60s: ${risk.maxLossPerMinuteDollars}</li>
                    <li>Daily stop-loss: ${risk.dailyStopLossDollars}</li>
                    <li>Intra-cycle drawdown: ${risk.intraCycleDrawdownDollars}</li>
                    <li>Max consecutive losing cycles: {risk.maxConsecutiveLosingCycles}</li>
                    <li>Per-market position cap: {risk.perMarketPositionCap}</li>
                    <li>Max open orders: {risk.maxOpenOrders}</li>
                  </ul>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      I have reviewed the risk limits above and accept the risk
                      of resuming the bot.
                    </span>
                  </label>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmed(false)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={!confirmed}
                onClick={handleRearm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Re-arm bot
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
