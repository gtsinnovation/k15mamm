import { useEffect } from "react";
import { useBotStore } from "@/lib/store";
import { forgetSessionPassphrase } from "./vault";
import { pause } from "@/lib/scheduler/loop";
import { toast } from "sonner";

/**
 * Wipes the in-memory PEM and forces re-entry of the passphrase after
 * `idleLockMinutes` of no user activity. The bot is paused first so we
 * never leave it running without credentials.
 *
 * Listens to: pointermove, keydown, visibilitychange (focus regained).
 */
export function useIdleLock() {
  const idleLockMinutes = useBotStore((s) => s.idleLockMinutes);
  const encryptedCredentials = useBotStore((s) => s.encryptedCredentials);
  const credentials = useBotStore((s) => s.credentials);

  useEffect(() => {
    if (idleLockMinutes <= 0) return;
    if (!encryptedCredentials || !credentials) return;
    const timeoutMs = idleLockMinutes * 60_000;
    let timer: number | null = null;

    const lockNow = () => {
      const s = useBotStore.getState();
      if (!s.credentials) return;
      if (s.runState === "running") pause();
      forgetSessionPassphrase();
      s.setCredentials(null);
      s.setVaultLocked(true);
      toast.warning("Vault auto-locked after idle timeout");
    };

    const reset = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(lockNow, timeoutMs);
    };

    const onActivity = () => reset();
    window.addEventListener("pointermove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("visibilitychange", onActivity);
    reset();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("visibilitychange", onActivity);
    };
  }, [idleLockMinutes, encryptedCredentials, credentials]);
}