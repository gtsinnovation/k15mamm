import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, ShieldAlert, LogOut, TrendingUp, Lock, Activity, Mail } from "lucide-react";
import { toast } from "sonner";
import heroImage from "@/assets/landing-hero.jpg";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

const ALLOWED_EMAIL = "gbsahn@gmail.com";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "denied"; email: string }
  | { status: "allowed"; email: string };

interface LandingProps {
  onAuthorized: () => void;
  requireOtp?: boolean;
  onOtpVerified?: () => void;
}

export default function Landing({ onAuthorized, requireOtp, onOtpVerified }: LandingProps) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [signingIn, setSigningIn] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const lastSubmittedOtpRef = useRef<string | null>(null);
  const otpSendInFlightRef = useRef(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      if (!email) {
        setState({ status: "signed_out" });
      } else if (email.toLowerCase() === ALLOWED_EMAIL.toLowerCase()) {
        setState({ status: "allowed", email });
      } else {
        setState({ status: "denied", email });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email ?? null;
      if (!email) setState({ status: "signed_out" });
      else if (email.toLowerCase() === ALLOWED_EMAIL.toLowerCase()) {
        setState({ status: "allowed", email });
      } else {
        setState({ status: "denied", email });
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (state.status === "allowed") onAuthorized();
  }, [state, onAuthorized]);

  // OTP is sent manually via the "Send verification code" button below.

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendOtp = async (email: string) => {
    if (otpSendInFlightRef.current || resendCooldown > 0) return;

    otpSendInFlightRef.current = true;
    setSendingOtp(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) {
        setOtpSent(false);
        toast.error("Could not send code", { description: error.message });
      } else {
        setOtp("");
        lastSubmittedOtpRef.current = null;
        setOtpSent(true);
        setResendCooldown(45);
        toast.success("Verification code sent", {
          description: `Check ${email} for a 6-digit code.`,
        });
      }
    } catch (e) {
      setOtpSent(false);
      toast.error("Could not send code", { description: (e as Error).message });
    } finally {
      otpSendInFlightRef.current = false;
      setSendingOtp(false);
    }
  };

  const verifyOtp = async (email: string, token: string) => {
    const normalizedToken = token.trim();
    if (normalizedToken.length !== 6 || lastSubmittedOtpRef.current === normalizedToken) {
      return;
    }

    lastSubmittedOtpRef.current = normalizedToken;
    setVerifyingOtp(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: normalizedToken,
        type: "email",
      });
      if (error) {
        lastSubmittedOtpRef.current = null;
        toast.error("Invalid code", { description: error.message });
        setOtp("");
      } else {
        toast.success("Verified");
        onOtpVerified?.();
      }
    } catch (e) {
      lastSubmittedOtpRef.current = null;
      toast.error("Verification failed", { description: (e as Error).message });
    } finally {
      setVerifyingOtp(false);
    }
  };

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
      {/* Background hero image with overlay */}
      <div className="absolute inset-0 -z-10">
        <img
          src={heroImage}
          alt=""
          width={1536}
          height={1024}
          className="h-full w-full object-cover opacity-40"
        />
        <div
          className="absolute inset-0"
          style={{ background: "var(--gradient-surface)" }}
        />
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
          <span className="font-semibold tracking-tight">Kalshi BTC MM</span>
        </div>
        {state.status !== "loading" && state.status !== "signed_out" && (
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        )}
      </header>

      <main className="container flex min-h-[calc(100vh-6rem)] flex-col items-center justify-center py-12">
        <div className="grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2">
          {/* Left: marketing copy */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Private beta · Invite only
            </div>
            <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl">
              Welcome{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-primary)" }}
              >
                back
              </span>
              .
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Sign in to access your private workspace.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Feature icon={TrendingUp} label="Adaptive quotes" />
              <Feature icon={Lock} label="Local key vault" />
              <Feature icon={ShieldCheck} label="Hard risk caps" />
            </div>
          </div>

          {/* Right: auth card */}
          <div className="lg:justify-self-end">
            <Card
              className="w-full max-w-md border-border/60 bg-card/80 backdrop-blur"
              style={{ boxShadow: "var(--shadow-glow)" }}
            >
              <CardContent className="space-y-5 p-8">
                {state.status === "loading" && (
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Checking session…
                    </p>
                  </div>
                )}

                {state.status === "signed_out" && (
                  <>
                    <div>
                      <h2 className="text-2xl font-semibold">Sign in to continue</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Access is restricted to the authorized account only.
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
                      By continuing you agree this app may store an encrypted
                      copy of your Kalshi credentials in your browser.
                    </p>
                  </>
                )}

                {state.status === "denied" && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                      <div className="space-y-1">
                        <p className="font-semibold text-destructive">
                          Access denied
                        </p>
                        <p className="text-sm text-destructive/90">
                          This account is not authorized.
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Sign in with the authorized Google account to continue.
                    </p>
                    <Button
                      onClick={handleSignOut}
                      variant="outline"
                      className="w-full"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign out & try another account
                    </Button>
                  </div>
                )}

                {state.status === "allowed" && (
                  <>
                    {requireOtp ? (
                      <div className="space-y-5">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Mail className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h2 className="text-xl font-semibold">
                              {otpSent ? "Enter verification code" : "Verify it's you"}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {otpSent
                                ? "Enter the 6-digit code we emailed you. Ignore any sign-in link."
                                : "Click below to email a 6-digit code to your inbox."}
                            </p>
                          </div>
                        </div>

                        {!otpSent ? (
                          <Button
                            onClick={() => sendOtp(state.email)}
                            disabled={sendingOtp || resendCooldown > 0}
                            size="lg"
                            className="w-full"
                          >
                            {sendingOtp ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Mail className="mr-2 h-4 w-4" />
                            )}
                            Send verification code
                          </Button>
                        ) : (
                          <>
                            <div className="flex justify-center">
                              <InputOTP
                                maxLength={6}
                                value={otp}
                                onChange={(v) => {
                                  setOtp(v);
                                  if (v.length === 6 && !verifyingOtp) {
                                    void verifyOtp(state.email, v);
                                  }
                                }}
                                disabled={verifyingOtp || sendingOtp}
                              >
                                <InputOTPGroup>
                                  <InputOTPSlot index={0} />
                                  <InputOTPSlot index={1} />
                                  <InputOTPSlot index={2} />
                                  <InputOTPSlot index={3} />
                                  <InputOTPSlot index={4} />
                                  <InputOTPSlot index={5} />
                                </InputOTPGroup>
                              </InputOTP>
                            </div>

                            <Button
                              onClick={() => verifyOtp(state.email, otp)}
                              disabled={otp.length !== 6 || verifyingOtp}
                              className="w-full"
                            >
                              {verifyingOtp && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              Verify & unlock dashboard
                            </Button>
                          </>
                        )}

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          {otpSent ? (
                            <button
                              type="button"
                              onClick={() => sendOtp(state.email)}
                              disabled={sendingOtp || resendCooldown > 0}
                              className="text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                            >
                              {sendingOtp
                                ? "Sending…"
                                : resendCooldown > 0
                                ? `Resend in ${resendCooldown}s`
                                : "Resend code"}
                            </button>
                          ) : (
                            <span>Code is only sent after you request it.</span>
                          )}
                          <button
                            type="button"
                            onClick={handleSignOut}
                            className="hover:underline"
                          >
                            Use another account
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 py-8">
                        <ShieldCheck className="h-6 w-6 text-primary" />
                        <p className="text-sm text-muted-foreground">
                          Welcome back — loading dashboard…
                        </p>
                      </div>
                    )}
                  </>
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