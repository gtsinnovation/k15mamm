import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SettingsPanel } from "@/components/mm/SettingsPanel";
import { UnlockGate } from "@/components/mm/UnlockGate";
import { Button } from "@/components/ui/button";
import { ArrowLeft, KeyRound } from "lucide-react";

/**
 * Dedicated page for managing Kalshi API credentials.
 *
 * Exposes the same vault UI as the in-dashboard Settings tab (enter / update
 * Key ID, RSA PEM, environment, proxy, vault passphrase, idle-lock timeout,
 * and lock / forget vault actions) at a stable, shareable URL — so users
 * can come straight here from the header without navigating tabs.
 *
 * Auth-gating is handled one level up by the same logic as the dashboard
 * (any signed-in user) so we don't duplicate auth checks here.
 */
export default function Credentials() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>Kalshi API Credentials — K15M AMM</title>
        <meta
          name="description"
          content="Add, update, or remove your Kalshi API Key ID and RSA private key. Your PEM is encrypted locally with AES-GCM and a passphrase you choose."
        />
        <link rel="canonical" href="https://k15mamm.webpwa.io/credentials" />
        <meta property="og:title" content="Kalshi API Credentials — K15M AMM" />
        <meta property="og:description" content="Manage your encrypted Kalshi API key vault." />
        <meta property="og:url" content="https://k15mamm.webpwa.io/credentials" />
      </Helmet>
      <UnlockGate />
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Kalshi credentials</h1>
              <p className="text-xs text-muted-foreground">
                Add, update, or remove your Kalshi API Key ID and RSA private key.
                The PEM is encrypted in your browser with a passphrase you choose.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
            </Link>
          </Button>
        </div>
      </header>
      <main className="container max-w-3xl py-6">
        <SettingsPanel />
      </main>
    </div>
  );
}
