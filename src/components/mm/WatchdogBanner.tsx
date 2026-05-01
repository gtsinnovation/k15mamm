import { useEffect, useRef } from "react";
import { useBotStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { AlertOctagon, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Surfaces watchdog alerts. The watchdog (in scheduler/loop.ts) raises an
 * alert when the tick loop fails repeatedly and auto-restart can't recover
 * — at which point we pause the bot and show this persistent banner plus a
 * sonner toast so the user sees it even if the dashboard tab is in the
 * background.
 */
export function WatchdogBanner() {
  const alertActive = useBotStore((s) => s.watchdog.alertActive);
  const alertReason = useBotStore((s) => s.watchdog.alertReason);
  const alertAt = useBotStore((s) => s.watchdog.alertAt);
  const restartCount = useBotStore((s) => s.watchdog.restartCount);
  const dismiss = useBotStore((s) => s.dismissWatchdogAlert);

  // Fire one toast per distinct alert (dedupe by alertAt).
  const lastToastedAt = useRef(0);
  useEffect(() => {
    if (alertActive && alertAt > 0 && alertAt !== lastToastedAt.current) {
      lastToastedAt.current = alertAt;
      toast.error("Bot stopped — watchdog tripped", {
        description: alertReason ?? "Repeated tick errors",
        duration: 15_000,
      });
    }
  }, [alertActive, alertAt, alertReason]);

  if (!alertActive) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive"
    >
      <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="font-semibold">Watchdog tripped — bot paused</div>
        <div className="text-xs text-destructive/90">{alertReason}</div>
        {restartCount > 0 && (
          <div className="text-xs text-muted-foreground">
            Auto-restarted {restartCount} time{restartCount === 1 ? "" : "s"} this session before giving up.
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          Check your network / Kalshi credentials, then press <span className="font-mono text-foreground">Start</span> to resume.
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={dismiss}
        aria-label="Dismiss watchdog alert"
        className="text-destructive hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
