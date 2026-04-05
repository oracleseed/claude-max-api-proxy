import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SessionRegistry } from "../manager.js";

type Msg = { role: "system" | "user" | "assistant"; content: string };

describe("Session Registry", () => {
  let registry: SessionRegistry;

  const sys: Msg = { role: "system", content: "You are Bob, a sharp quant assistant." };
  const u1: Msg = { role: "user", content: "Hello" };

  beforeEach(() => {
    registry = new SessionRegistry({ ttlMs: 5000, persistPath: "" });
  });

  it("creates new session entry on first lookup", () => {
    const entry = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    assert.ok(entry.sessionUUID);
    assert.strictEqual(entry.state, "idle");
    assert.strictEqual(entry.model, "opus");
    assert.strictEqual(entry.requestCount, 0);
  });

  it("returns same session on subsequent lookup", () => {
    const e1 = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    const e2 = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    assert.strictEqual(e1.sessionUUID, e2.sessionUUID);
  });

  it("returns different sessions for different agent keys", () => {
    const e1 = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    const e2 = registry.getOrCreate("agent-2", "opus", [sys, u1]);
    assert.notStrictEqual(e1.sessionUUID, e2.sessionUUID);
  });

  it("invalidates session", () => {
    const entry = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    registry.invalidate("agent-1");
    assert.strictEqual(entry.state, "invalidated");
  });

  it("generates new UUID after invalidation on next getOrCreate", () => {
    const e1 = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    const oldUUID = e1.sessionUUID;
    registry.invalidate("agent-1");
    const e2 = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    assert.notStrictEqual(e2.sessionUUID, oldUUID);
    assert.strictEqual(e2.state, "idle");
  });

  it("removes session entry", () => {
    registry.getOrCreate("agent-1", "opus", [sys, u1]);
    registry.remove("agent-1");
    assert.strictEqual(registry.size, 0);
  });

  it("records messages after updateHistory", () => {
    const entry = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    registry.updateHistory("agent-1", [sys, u1], false);
    assert.strictEqual(entry.messagesRaw.length, 2);
    assert.strictEqual(entry.requestCount, 1);
  });

  it("replaces history on full prompt (replace=true)", () => {
    registry.getOrCreate("agent-1", "opus", [sys, u1]);
    registry.updateHistory("agent-1", [sys, u1], false);
    const u2: Msg = { role: "user", content: "New convo" };
    registry.updateHistory("agent-1", [sys, u2], true);
    const entry = registry.get("agent-1")!;
    assert.strictEqual(entry.messagesRaw.length, 2);
    assert.strictEqual((entry.messagesRaw[1] as any).content, "New convo");
  });

  it("evicts stale sessions", async () => {
    registry = new SessionRegistry({ ttlMs: 100, persistPath: "" });
    registry.getOrCreate("agent-1", "opus", [sys, u1]);
    await new Promise((r) => setTimeout(r, 200));
    registry.evictStale();
    assert.strictEqual(registry.size, 0);
  });

  it("generates valid UUID v4 for sessionUUID", () => {
    const entry = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.ok(
      uuidRegex.test(entry.sessionUUID),
      `Invalid UUID: ${entry.sessionUUID}`
    );
  });

  it("setBusy and setIdle work correctly", () => {
    const entry = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    registry.setBusy("agent-1");
    assert.strictEqual(entry.state, "busy");
    registry.setIdle("agent-1");
    assert.strictEqual(entry.state, "idle");
  });

  it("incrementFallback tracks count", () => {
    const entry = registry.getOrCreate("agent-1", "opus", [sys, u1]);
    registry.incrementFallback("agent-1");
    registry.incrementFallback("agent-1");
    assert.strictEqual(entry.fallbackCount, 2);
  });
});
