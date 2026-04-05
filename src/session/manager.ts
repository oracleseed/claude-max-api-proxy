/**
 * Session Registry — tracks active agent sessions with message history,
 * state management, and disk persistence. Replaces the old SessionManager.
 */

import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import { hashMessage } from "./differ.js";

interface Message {
  role: string;
  content: string | unknown[];
}

export interface SessionEntry {
  agentKey: string;
  sessionUUID: string;
  messagesRaw: Message[];
  messagesHashes: string[];
  lastActivity: number;
  state: "idle" | "busy" | "invalidated";
  model: string;
  requestCount: number;
  fallbackCount: number;
  openclawSessionKey: string | null;
}

export interface RegistryOptions {
  ttlMs: number;
  persistPath: string;
  persistIntervalMs: number;
}

export class SessionRegistry {
  private entries = new Map<string, SessionEntry>();
  private opts: RegistryOptions;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private evictTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: Partial<RegistryOptions> = {}) {
    this.opts = {
      ttlMs: opts.ttlMs ?? 6 * 60 * 60 * 1000, // 6h
      persistPath: opts.persistPath ?? "",
      persistIntervalMs: opts.persistIntervalMs ?? 60_000,
    };

    // Start periodic eviction (every 10 min) — only if not in test mode
    if (this.opts.ttlMs > 1000) {
      this.evictTimer = setInterval(() => this.evictStale(), 10 * 60 * 1000);
    }

    // Start periodic persistence
    if (this.opts.persistPath) {
      this.persistTimer = setInterval(
        () => this.saveToDisk(),
        this.opts.persistIntervalMs
      );
    }
  }

  getOrCreate(
    agentKey: string,
    model: string,
    _messages: Message[]
  ): SessionEntry {
    const existing = this.entries.get(agentKey);

    if (existing && existing.state !== "invalidated") {
      existing.lastActivity = Date.now();
      return existing;
    }

    // Create new (or replace invalidated)
    const entry: SessionEntry = {
      agentKey,
      sessionUUID: uuidv4(),
      messagesRaw: [],
      messagesHashes: [],
      lastActivity: Date.now(),
      state: "idle",
      model,
      requestCount: 0,
      fallbackCount: 0,
      openclawSessionKey: null,
    };

    this.entries.set(agentKey, entry);
    return entry;
  }

  get(agentKey: string): SessionEntry | undefined {
    return this.entries.get(agentKey);
  }

  invalidate(agentKey: string): void {
    const entry = this.entries.get(agentKey);
    if (entry) entry.state = "invalidated";
  }

  remove(agentKey: string): void {
    this.entries.delete(agentKey);
  }

  updateHistory(
    agentKey: string,
    messages: Message[],
    replace: boolean
  ): void {
    const entry = this.entries.get(agentKey);
    if (!entry) return;

    entry.messagesRaw = [...messages];
    entry.messagesHashes = messages.map(hashMessage);
    entry.requestCount++;
    entry.lastActivity = Date.now();
  }

  setBusy(agentKey: string): void {
    const entry = this.entries.get(agentKey);
    if (entry) entry.state = "busy";
  }

  setIdle(agentKey: string): void {
    const entry = this.entries.get(agentKey);
    if (entry && entry.state === "busy") entry.state = "idle";
  }

  incrementFallback(agentKey: string): void {
    const entry = this.entries.get(agentKey);
    if (entry) entry.fallbackCount++;
  }

  evictStale(): number {
    const cutoff = Date.now() - this.opts.ttlMs;
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.lastActivity < cutoff) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.error(`[Registry] Evicted ${removed} stale sessions`);
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  getAll(): SessionEntry[] {
    return Array.from(this.entries.values());
  }

  async saveToDisk(): Promise<void> {
    if (!this.opts.persistPath) return;
    try {
      const data = Object.fromEntries(
        Array.from(this.entries.entries()).map(([k, v]) => [
          k,
          {
            agentKey: v.agentKey,
            sessionUUID: v.sessionUUID,
            model: v.model,
            lastActivity: v.lastActivity,
            requestCount: v.requestCount,
            fallbackCount: v.fallbackCount,
            state: v.state === "busy" ? "idle" : v.state,
          },
        ])
      );
      await fs.writeFile(this.opts.persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("[Registry] Save error:", err);
    }
  }

  async loadFromDisk(): Promise<void> {
    if (!this.opts.persistPath) return;
    try {
      const raw = await fs.readFile(this.opts.persistPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, Partial<SessionEntry>>;
      for (const [key, saved] of Object.entries(data)) {
        if (!this.entries.has(key) && saved.sessionUUID) {
          this.entries.set(key, {
            agentKey: saved.agentKey ?? key,
            sessionUUID: saved.sessionUUID,
            messagesRaw: [],
            messagesHashes: [],
            lastActivity: saved.lastActivity ?? Date.now(),
            state: "invalidated", // force full prompt after reload
            model: saved.model ?? "opus",
            requestCount: saved.requestCount ?? 0,
            fallbackCount: saved.fallbackCount ?? 0,
            openclawSessionKey: null,
          });
        }
      }
      console.error(
        `[Registry] Loaded ${this.entries.size} sessions from disk`
      );
    } catch {
      // File doesn't exist yet — normal on first run
    }
  }

  shutdown(): void {
    if (this.persistTimer) clearInterval(this.persistTimer);
    if (this.evictTimer) clearInterval(this.evictTimer);
  }
}
