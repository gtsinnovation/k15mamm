import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type PrepStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface PrepStep {
  id: string;
  label: string;
  status: PrepStepStatus;
  detail?: string;
}

/**
 * Modal shown while we prefetch the data that the pre-start collateral
 * simulation needs (BTC spot, BTC hourly markets list). One row per step
 * with a live status icon and a top-level progress bar.
 */
export function PreparingSimulationDialog({
  open,
  steps,
}: {
  open: boolean;
  steps: PrepStep[];
}) {
  const total = steps.length;
  const finished = steps.filter(
    (s) => s.status === "done" || s.status === "skipped" || s.status === "error",
  ).length;
  const pct = total === 0 ? 0 : Math.round((finished / total) * 100);
  const anyError = steps.some((s) => s.status === "error");

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {anyError ? (
              <XCircle className="h-5 w-5 text-destructive" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
            Preparing simulation
          </DialogTitle>
          <DialogDescription>
            Fetching live market data so the collateral estimate is accurate.
          </DialogDescription>
        </DialogHeader>

        <Progress value={pct} aria-label="preparation progress" />

        <ol className="space-y-2 pt-1">
          {steps.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-2.5"
            >
              <StepIcon status={s.status} />
              <div className="flex-1">
                <div
                  className={cn(
                    "text-sm font-medium",
                    s.status === "error" && "text-destructive",
                    s.status === "done" && "text-success",
                  )}
                >
                  {s.label}
                </div>
                {s.detail && (
                  <div className="text-xs text-muted-foreground">{s.detail}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function StepIcon({ status }: { status: PrepStepStatus }) {
  if (status === "running")
    return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />;
  if (status === "done")
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />;
  if (status === "error")
    return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />;
  if (status === "skipped")
    return (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-60" />
    );
  return (
    <div className="mt-1 h-3 w-3 shrink-0 rounded-full border border-muted-foreground/40" />
  );
}