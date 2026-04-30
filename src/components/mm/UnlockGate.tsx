import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useBotStore } from "@/lib/store";
import { decryptPem, encryptPem, getSessionPassphrase, rememberPassphraseForSession } from "@/lib/security/vault";
import { readAndClearLegacyCreds } from "@/lib/security/bootstrap";
import { Lock, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

type Mode = "unlock" | "set" | "migrate";

/**
 * Modal that gates access to the Kalshi private key.
 *
 * Three modes:
 *  - "unlock": vault exists, ask for passphrase to decrypt PEM into memory.
 *  - "set": user just entered fresh credentials, ask them to choose a passphrase.
 *  - "migrate": legacy plaintext credentials were found in localStorage —
 *               ask for a new passphrase, encrypt them, wipe plaintext.
 */
export function UnlockGate() {
  const encryptedCredentials = useBotStore((s) => s.encryptedCredentials);
  const credentials = useBotStore((s) => s.credentials);
  const vaultLocked = useBotStore((s) => s.vaultLocked);
  const setCredentials = useBotStore((s) => s.setCredentials);
  const setEncryptedCredentials = useBotStore((s) => s.setEncryptedCredentials);
  const setVaultLocked = useBotStore((s) => s.setVaultLocked);

  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<ReturnType<typeof readAndClearLegacyCreds>>(null);
  const bootedRef = useRef(false);

  // One-time bootstrap: migrate legacy plaintext creds, lock vault on cold start.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const legacyCreds = readAndClearLegacyCreds();
    if (legacyCreds) {
      setLegacy(legacyCreds);
      setVaultLocked(true);
      return;
    }
    if (encryptedCredentials && !credentials) {
      // Try silent unlock from session passphrase.
      const sess = getSessionPassphrase();
      if (sess) {
        decryptPem(encryptedCredentials.pemCipher, sess)
          .then((pem) => {
            setCredentials({
              keyId: encryptedCredentials.keyId,
              env: encryptedCredentials.env,
              corsProxy: encryptedCredentials.corsProxy,
              privateKeyPem: pem,
            });
            setVaultLocked(false);
          })
          .catch(() => setVaultLocked(true));
      } else {
        setVaultLocked(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mode: Mode | null = legacy
    ? "migrate"
    : vaultLocked && encryptedCredentials
    ? "unlock"
    : null;

  if (!mode) return null;

  const handleUnlock = async () => {
    if (!encryptedCredentials || !pass1) return;
    setBusy(true);
    setError(null);
    try {
      const pem = await decryptPem(encryptedCredentials.pemCipher, pass1);
      setCredentials({
        keyId: encryptedCredentials.keyId,
        env: encryptedCredentials.env,
        corsProxy: encryptedCredentials.corsProxy,
        privateKeyPem: pem,
      });
      rememberPassphraseForSession(pass1);
      setVaultLocked(false);
      setPass1("");
      toast.success("Vault unlocked");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleMigrate = async () => {
    if (!legacy) return;
    if (pass1.length < 8) { setError("Passphrase must be at least 8 characters"); return; }
    if (pass1 !== pass2) { setError("Passphrases do not match"); return; }
    setBusy(true);
    setError(null);
    try {
      const cipher = await encryptPem(legacy.privateKeyPem, pass1);
      setEncryptedCredentials({
        v: 1,
        keyId: legacy.keyId,
        env: legacy.env,
        corsProxy: legacy.corsProxy,
        pemCipher: cipher,
      });
      setCredentials(legacy);
      rememberPassphraseForSession(pass1);
      setVaultLocked(false);
      setLegacy(null);
      setPass1("");
      setPass2("");
      toast.success("Credentials encrypted and stored");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => { /* gate is non-dismissible while locked */ }}>
      <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "migrate" ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            {mode === "migrate" ? "Encrypt your credentials" : "Unlock vault"}
          </DialogTitle>
          <DialogDescription>
            {mode === "migrate"
              ? "Your existing API key was stored unencrypted. Choose a passphrase to encrypt it. The passphrase never leaves your browser and isn't recoverable — store it somewhere safe."
              : "Enter your passphrase to decrypt the Kalshi private key. It is held only in memory and wiped on idle timeout or page reload."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vault-pass">Passphrase</Label>
            <div className="relative">
              <Input
                id="vault-pass"
                type={show1 ? "text" : "password"}
                value={pass1}
                onChange={(e) => setPass1(e.target.value)}
                autoFocus
                className="pr-10"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (mode === "unlock") void handleUnlock();
                    else void handleMigrate();
                  }
                }}
              />
              <button
                type="button"
                aria-label={show1 ? "Hide passphrase" : "Show passphrase"}
                onClick={() => setShow1((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {mode === "migrate" && (
            <div className="space-y-1.5">
              <Label htmlFor="vault-pass2">Confirm passphrase</Label>
              <div className="relative">
                <Input
                  id="vault-pass2"
                  type={show2 ? "text" : "password"}
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  aria-label={show2 ? "Hide passphrase" : "Show passphrase"}
                  onClick={() => setShow2((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => (mode === "unlock" ? handleUnlock() : handleMigrate())}
            disabled={busy || !pass1}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "unlock" ? "Unlock" : "Encrypt & continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}