import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

const ACCEPT_KEY = "risk-disclaimer-accepted-v1";

/**
 * One-time risk acknowledgement gate. Blocks the dashboard until the user
 * accepts. Choice is persisted in localStorage; clearing site data (or the
 * Settings → Delete all local data button) resets it.
 */
export function RiskDisclaimerGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setAccepted(localStorage.getItem(ACCEPT_KEY) === "1");
    } catch {
      setAccepted(true); // fail-open if storage unavailable
    }
  }, []);

  if (accepted === null) {
    return <div className="min-h-screen bg-background" />;
  }
  if (accepted) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-xl space-y-5 rounded-lg border border-destructive/40 bg-card p-6 shadow-lg">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-1 h-6 w-6 text-destructive" />
          <div>
            <h2 className="text-lg font-bold">Important risk disclaimer</h2>
            <p className="text-sm text-muted-foreground">
              Please read before using the market maker.
            </p>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <p>
            Automated trading involves substantial risk of loss and is not
            suitable for all investors. Past performance is not indicative of
            future results.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>You may lose all collateral committed to a market.</li>
            <li>Software bugs, network outages, or proxy failures can result in losses.</li>
            <li>Market conditions and Kalshi liquidity can change rapidly.</li>
            <li>You alone are responsible for orders the bot places on your account.</li>
            <li>This software is provided as-is, with no warranty of any kind.</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            See the <Link to="/privacy" className="underline">Privacy Policy</Link> for
            how data is stored locally.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => {
              try { localStorage.setItem(ACCEPT_KEY, "1"); } catch { /* ignore */ }
              setAccepted(true);
            }}
          >
            I understand and accept the risks
          </Button>
        </div>
      </div>
    </div>
  );
}

export function clearRiskAcceptance() {
  try { localStorage.removeItem(ACCEPT_KEY); } catch { /* ignore */ }
}