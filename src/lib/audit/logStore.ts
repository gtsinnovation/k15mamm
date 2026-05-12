/**
 * IndexedDB-backed audit log persistence.
 *
 * The in-memory `logs` array in the bot store is capped at 500 entries and
 * lost on reload. For compliance / post-mortem we mirror every entry into
 * IndexedDB (capped at 10k rows) so the user can export their full session
 * history as JSON and so a crash doesn't lose recent context.
 *
 * Pure browser API — no extra dependency. Fails silently if IndexedDB is
 * unavailable (Safari private mode, very old browsers); the in-memory log
 * still works.
 */

import type { LogEntry } from "@/lib/store";

const DB_NAME = "kalshi-mm-audit";
const STORE = "logs";
const MISMATCH_STORE = "ticker_mismatches";
const MAX_ROWS = 10_000;
const MAX_MISMATCH_ROWS = 2_000;
const VERSION = 2;

/**
 * Structured audit row written every time the fill reconciler detects that
 * a fill's reported ticker disagrees with the order's stored expected
 * ticker (or when no ticker could be resolved at all). Persisted to a
 * dedicated IndexedDB store so operators can export and review without
 * sifting through the general log stream.
 */
export interface TickerMismatchEntry {
  ts: number;
  orderId: string;
  /** What the fill reported (may be null when the API gave us nothing). */
  fillTicker: string | null;
  /** What we stored on the order ledger when the order was placed. */
  expectedTicker: string | null;
  tradeId: string;
  /** "mismatch" = both sides present and differ, "unresolved" = nothing usable. */
  kind: "mismatch" | "unresolved";
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        os.createIndex("ts", "ts", { unique: false });
      }
      if (!db.objectStoreNames.contains(MISMATCH_STORE)) {
        const os = db.createObjectStore(MISMATCH_STORE, { keyPath: "id", autoIncrement: true });
        os.createIndex("ts", "ts", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

export async function appendAuditEntry(entry: LogEntry): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  // Best-effort trim — only runs occasionally to avoid hot-path overhead.
  if (Math.random() < 0.02) void trim();
}

export async function appendTickerMismatch(entry: TickerMismatchEntry): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(MISMATCH_STORE, "readwrite");
    tx.objectStore(MISMATCH_STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  if (Math.random() < 0.05) void trimMismatches();
}

export async function exportTickerMismatches(): Promise<TickerMismatchEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(MISMATCH_STORE, "readonly");
    const req = tx.objectStore(MISMATCH_STORE).getAll();
    req.onsuccess = () => resolve(req.result as TickerMismatchEntry[]);
    req.onerror = () => resolve([]);
  });
}

export async function clearTickerMismatches(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(MISMATCH_STORE, "readwrite");
    tx.objectStore(MISMATCH_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function trimMismatches(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(MISMATCH_STORE, "readwrite");
    const os = tx.objectStore(MISMATCH_STORE);
    const countReq = os.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_MISMATCH_ROWS;
      if (excess <= 0) return resolve();
      const cursorReq = os.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || removed >= excess) return resolve();
        cur.delete();
        removed++;
        cur.continue();
      };
      cursorReq.onerror = () => resolve();
    };
    countReq.onerror = () => resolve();
  });
}

async function trim(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const countReq = os.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_ROWS;
      if (excess <= 0) return resolve();
      const cursorReq = os.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || removed >= excess) return resolve();
        cur.delete();
        removed++;
        cur.continue();
      };
      cursorReq.onerror = () => resolve();
    };
    countReq.onerror = () => resolve();
  });
}

export async function exportAuditLog(): Promise<LogEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as LogEntry[]);
    req.onerror = () => resolve([]);
  });
}

export async function clearAuditLog(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Trigger a JSON download of the full IndexedDB audit log. */
export async function downloadAuditLog(): Promise<number> {
  const rows = await exportAuditLog();
  const blob = new Blob([JSON.stringify(rows, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kalshi-mm-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}