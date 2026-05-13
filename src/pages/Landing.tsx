import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, LogOut, TrendingUp, Lock, Activity } from "lucide-react";
import { toast } from "sonner";
import heroImage from "@/assets/landing-hero.jpg";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "allowed"; email: string };

interface LandingProps {
  onAuthorized: () => void;
}

export default function Landing({ onAuthorized }: LandingProps) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const apply = (email: string | null | undefined) => {
      if (!email) setState({ status: "signed_out" });
      else setState({ status: "allowed", email });
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      apply(session?.user?.email),
    );
    supabase.auth.getSession().then(({ data: { session } }) =>
      apply(session?.user?.email),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (state.status === "allowed") onAuthorized();
  }, [state, onAuthorized]);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Sign-in failed", { description: result.error.message });
        setSigningIn(false);
      }
    } catch (e) {
      toast.error("Sign-in failed", { description: (e as Error).message });
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 -z-10">
        <img
          src={heroImage}
          alt=""
          width={1536}
          height={1024}
          className="h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0" style={{ background: "var(--gradient-surface)" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
      </div>

      <header className="container flex items-center justify-between py-6">
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "var(--gradient-primary)" }}
          >
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-semibold tracking-tight">K15M AMM</span>
        </div>
        {state.status === "allowed" && (
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        )}
      </header>

      <main className="container flex min-h-[calc(100vh-6rem)] flex-col items-center justify-center py-12">
        <div className="grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Bring your own Kalshi keys
            </div>
            <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl">
              K15M{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-primary)" }}
              >
                AMM
              </span>
              <span className="block text-2xl font-medium text-muted-foreground sm:text-3xl mt-2">
                Automated Market Maker for Kalshi BTC
              </span>
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              An automated market maker for Kalshi's BTC 15-minute contracts.
              Sign in, paste your own Kalshi API Key ID and RSA private key, and
              the bot runs locally in your browser — keys stay encrypted on your device.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Feature icon={TrendingUp} label="Adaptive quotes" />
              <Feature icon={Lock} label="Local key vault" />
              <Feature icon={ShieldCheck} label="Hard risk caps" />
            </div>
          </div>

          <div className="lg:justify-self-end">
            <Card
              className="w-full max-w-md border-border/60 bg-card/80 backdrop-blur"
              style={{ boxShadow: "var(--shadow-glow)" }}
            >
              <CardContent className="space-y-5 p-8">
                {state.status === "loading" && (
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Checking session…</p>
                  </div>
                )}

                {state.status === "signed_out" && (
                  <>
                    <div>
                      <h2 className="text-2xl font-semibold">Sign in to continue</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Create an account or sign in with Google. After signing in
                        you'll add your own Kalshi API credentials inside the app.
                      </p>
                    </div>
                    <Button
                      onClick={handleSignIn}
                      disabled={signingIn}
                      size="lg"
                      className="w-full"
                    >
                      {signingIn ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <GoogleIcon className="mr-2 h-4 w-4" />
                      )}
                      Continue with Google
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Your Kalshi private key never leaves your browser. It's
                      encrypted with a passphrase you choose.
                    </p>
                  </>
                )}

                {state.status === "allowed" && (
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <ShieldCheck className="h-6 w-6 text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Welcome — loading dashboard…
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon: Icon, label }: { icon: typeof TrendingUp; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-sm backdrop-blur">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-foreground/90">{label}</span>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
