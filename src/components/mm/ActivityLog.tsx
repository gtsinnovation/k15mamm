import { useBotStore, type LogLevel } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadAuditLog } from "@/lib/audit/logStore";
import { toast } from "sonner";
import { Download } from "lucide-react";

const colors: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-warning",
  error: "text-destructive",
  quote: "text-primary",
  fill: "text-success",
};

export function ActivityLog() {
  const { logs, clearLogs } = useBotStore();
  const onExport = async () => {
    try {
      const n = await downloadAuditLog();
      toast.success(`Exported ${n} audit log entr${n === 1 ? "y" : "ies"}`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  };
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-lg font-semibold">Activity log</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onExport}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export JSON
          </Button>
          <Button variant="ghost" size="sm" onClick={clearLogs}>Clear</Button>
        </div>
      </div>
      <ScrollArea className="h-[300px]">
        <div className="space-y-1 p-3 font-mono text-xs">
          {logs.length === 0 && <div className="text-muted-foreground">No activity yet.</div>}
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span>
              <span className={cn("uppercase w-12", colors[l.level])}>{l.level}</span>
              {l.ticker && <span className="text-accent-foreground">{l.ticker}</span>}
              <span className="flex-1">{l.msg}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
