import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container max-w-3xl py-10">
        <Button asChild variant="ghost" size="sm" className="mb-6">
          <Link to="/"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Link>
        </Button>
        <article className="prose prose-invert max-w-none space-y-4 text-sm leading-relaxed">
          <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: {new Date().toISOString().slice(0, 10)}</p>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What we collect</h2>
            <p>
              K15M AMM is a local-first application. The minimum data
              necessary for the app to function is:
            </p>
            <ul className="list-disc pl-6">
              <li>Your Kalshi API Key ID and RSA private key, encrypted with AES-GCM
                (PBKDF2-SHA256, 250,000 iterations) using a passphrase you provide.</li>
              <li>Your strategy parameters, risk limits, and tracked tickers.</li>
              <li>An activity log of bot actions and an order ledger, kept locally
                in your browser.</li>
              <li>Your email address, used only to send a one-time login code via
                our authentication provider.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Where data is stored</h2>
            <p>
              Settings, the encrypted credential vault, and the activity log live in
              your browser (<code>localStorage</code> and <code>IndexedDB</code>). Your
              decrypted RSA key only exists in memory while the vault is unlocked and
              is wiped on idle auto-lock or browser close.
            </p>
            <p>
              Authentication state (your session) is managed by our backend provider
              (Lovable Cloud). Kalshi API calls are signed in your browser and either
              sent direct or relayed through the Lovable Cloud edge proxy you select
              in Settings — your private key never leaves the browser.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Third parties</h2>
            <ul className="list-disc pl-6">
              <li><strong>Kalshi</strong> — receives signed trading requests.</li>
              <li><strong>Coinbase</strong> — public BTC spot price feed.</li>
              <li><strong>Lovable Cloud</strong> — authentication and the optional edge proxy.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Deletion</h2>
            <p>
              You can wipe every piece of local state at any time from
              <strong> Settings → Delete all local data</strong>. This forgets the
              encrypted vault, clears the activity log and order ledger, and signs
              you out. Clearing your browser's site data has the same effect.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Risk disclosure</h2>
            <p>
              Automated trading involves substantial risk of loss. This tool is
              provided as-is for the operator's own use; no investment advice is
              given and no guarantees are made about performance, uptime, or
              correctness. You are solely responsible for orders placed by the bot.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Security disclosure</h2>
            <p>
              Please report security issues privately per our
              {" "}<a className="underline" href="/.well-known/security.txt">security.txt</a>.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}