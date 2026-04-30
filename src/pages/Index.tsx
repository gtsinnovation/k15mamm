import { useEffect, useState } from "react";
import { StatusHeader } from "@/components/mm/StatusHeader";
import { ControlBar } from "@/components/mm/ControlBar";
import { BotStatusBanner } from "@/components/mm/BotStatusBanner";
import { MarketsPanel } from "@/components/mm/MarketsPanel";
import { StrategyPanel } from "@/components/mm/StrategyPanel";
import { RiskPanel } from "@/components/mm/RiskPanel";
import { ActivityLog } from "@/components/mm/ActivityLog";
import { PnlChart } from "@/components/mm/PnlChart";
import { SettingsPanel } from "@/components/mm/SettingsPanel";
import { CollateralPanel } from "@/components/mm/CollateralPanel";
import { OrderLedgerPanel } from "@/components/mm/OrderLedgerPanel";
import { UnlockGate } from "@/components/mm/UnlockGate";
import { useIdleLock } from "@/lib/security/useIdleLock";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBotStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { KeyRound, History, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import { subscribeSpot } from "@/lib/kalshi/spotPoll";

const Index = () => {
  const [tab, setTab] = useState("dashboard");
  const credentials = useBotStore((s) => s.credentials);
  const encryptedCredentials = useBotStore((s) => s.encryptedCredentials);
  useIdleLock();
  const hasAnyCreds = !!credentials || !!encryptedCredentials;

  // Prefetch BTC spot via the centralized rate-limit-aware poller so the
  // pre-start simulation has a price ready even before the bot is running.
  useEffect(() => {
    return subscribeSpot((price) => {
      if (price != null) useBotStore.getState().setBtcSpot(price);
    });
  }, []);

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
