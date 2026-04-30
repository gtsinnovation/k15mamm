import { useEffect, useState } from "react";
import { StatusHeader } from "@/components/mm/StatusHeader";
import { ControlBar } from "@/components/mm/ControlBar";
import { BotStatusBanner } from "@/components/mm/BotStatusBanner";
import { MarketsPanel } from "@/components/mm/MarketsPanel";
import { StrategyPanel } from "@/components/mm/StrategyPanel";
import { RiskPanel } from "@/components/mm/RiskPanel";
import { CircuitBreakerPanel } from "@/components/mm/CircuitBreakerPanel";
import { ActivityLog } from "@/components/mm/ActivityLog";
import { PnlChart } from "@/components/mm/PnlChart";
import { SettingsPanel } from "@/components/mm/SettingsPanel";
import { CollateralPanel } from "@/components/mm/CollateralPanel";
import { OrderLedgerPanel } from "@/components/mm/OrderLedgerPanel";
import { UnlockGate } from "@/components/mm/UnlockGate";
import { useIdleLock } from "@/lib/security/useIdleLock";
import { useSettingsSync } from "@/lib/security/useSettingsSync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBotStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { KeyRound, History, ScrollText, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { subscribeSpot } from "@/lib/kalshi/spotPoll";

const Index = () => {
  const [tab, setTab] = useState("dashboard");
  const credentials = useBotStore((s) => s.credentials);
  const encryptedCredentials = useBotStore((s) => s.encryptedCredentials);
  const autoRefresh = useBotStore((s) => s.autoRefreshEnabled);
  const setAutoRefresh = useBotStore((s) => s.setAutoRefreshEnabled);
  useIdleLock();
  useSettingsSync();
  const hasAnyCreds = !!credentials || !!encryptedCredentials;

  // Prefetch BTC spot via the centralized rate-limit-aware poller so the
  // pre-start simulation has a price ready even before the bot is running.
  // Gated on the auto-refresh toggle so users can pause background polling.
  useEffect(() => {
    if (!autoRefresh) return;
    return subscribeSpot((price) => {
      if (price != null) useBotStore.getState().setBtcSpot(price);
    });
  }, [autoRefresh]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <UnlockGate />
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">K15M AMM</h1>
            <p className="text-xs text-muted-foreground">
              Avellaneda–Stoikov · Kalshi BTC 15-minute contracts · Local browser bot
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-1 flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
              <RefreshCw
                className={`h-3.5 w-3.5 ${autoRefresh ? "text-success" : "text-muted-foreground"}`}
              />
              <Label htmlFor="auto-refresh" className="text-xs">
                Auto-refresh
              </Label>
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/backtest">
                <History className="mr-2 h-4 w-4" /> Backtest
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/audit">
                <ScrollText className="mr-2 h-4 w-4" /> Audit log
              </Link>
            </Button>
            <Button
              asChild
              variant={hasAnyCreds ? "outline" : "default"}
              size="sm"
            >
              <Link to="/credentials">
                <KeyRound className="mr-2 h-4 w-4" />
                {hasAnyCreds ? "Manage credentials" : "Add API credentials"}
              </Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="container space-y-6 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="space-y-6">
            <BotStatusBanner />
            <StatusHeader />
            <ControlBar />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <MarketsPanel />
                <CollateralPanel />
                <OrderLedgerPanel />
                <PnlChart />
                <ActivityLog />
              </div>
              <div className="space-y-6">
                <CircuitBreakerPanel />
                <StrategyPanel />
                <RiskPanel />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="settings">
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
