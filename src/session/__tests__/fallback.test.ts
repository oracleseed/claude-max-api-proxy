import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { FallbackController } from "../fallback.js";
import { SessionRegistry } from "../manager.js";

type Msg = { role: "system" | "user" | "assistant"; content: string };

describe("Fallback Controller", () => {
  let registry: SessionRegistry;
  let controller: FallbackController;

  const sys: Msg = { role: "system", content: "You are Bob." };
  const u1: Msg = { role: "user", content: "Hello" };
  const a1: Msg = { role: "assistant", content: "Hi!" };
  const u2: Msg = { role: "user", content: "How are you?" };

  beforeEach(() => {
    registry = new SessionRegistry({ ttlMs: 60000, persistPath: "" });
    controller = new FallbackController(registry);
  });

  it("returns FULL_PROMPT for first request (no session)", () => {
    const result = controller.decide("agent-1", "opus", [sys, u1], true);
    assert.strictEqual(result.mode, "full_prompt");
    assert.ok(result.sessionUUID);
    assert.strictEqual(result.reason, "new_session");
  });

  it("returns DELTA when prefix matches and new messages exist", () => {
    controller.decide("agent-1", "opus", [sys, u1], true);
    registry.updateHistory("agent-1", [sys, u1], true);

    const r2 = controller.decide("agent-1", "opus", [sys, u1, a1, u2], true);
    assert.strictEqual(r2.mode, "delta");
    assert.ok(r2.deltaMessages);
    assert.strictEqual(r2.deltaMessages!.length, 1);
    assert.strictEqual((r2.deltaMessages![0] as Msg).content, "How are you?");
  });

  it("returns FULL_PROMPT when prefix diverges", () => {
    controller.decide("agent-1", "opus", [sys, u1], true);
    registry.updateHistory("agent-1", [sys, u1], true);

    const differentU1: Msg = { role: "user", content: "Different message" };
    const r2 = controller.decide("agent-1", "opus", [sys, differentU1], true);
    assert.strictEqual(r2.mode, "full_prompt");
    assert.strictEqual(r2.reason, "prefix_mismatch");
  });

  it("returns STATELESS when gateway is disconnected", () => {
    const result = controller.decide("agent-1", "opus", [sys, u1], false);
    assert.strictEqual(result.mode, "stateless");
    assert.strictEqual(result.reason, "gateway_disconnected");
  });

  it("returns FULL_PROMPT when session is invalidated", () => {
    controller.decide("agent-1", "opus", [sys, u1], true);
    registry.updateHistory("agent-1", [sys, u1], true);
    registry.invalidate("agent-1");

    const r2 = controller.decide("agent-1", "opus", [sys, u1, a1, u2], true);
    assert.strictEqual(r2.mode, "full_prompt");
    assert.strictEqual(r2.reason, "invalidated");
  });

  it("returns STATELESS when no new user messages in delta", () => {
    controller.decide("agent-1", "opus", [sys, u1], true);
    registry.updateHistory("agent-1", [sys, u1], true);

    // Only assistant message added, no new user message
    const r2 = controller.decide("agent-1", "opus", [sys, u1, a1], true);
    assert.strictEqual(r2.mode, "stateless");
    assert.strictEqual(r2.reason, "no_new_messages");
  });

  it("tracks mode stats", () => {
    controller.decide("agent-1", "opus", [sys, u1], true);
    registry.updateHistory("agent-1", [sys, u1], true);
    controller.decide("agent-1", "opus", [sys, u1, a1, u2], true);
    controller.decide("agent-2", "opus", [sys, u1], false);

    const stats = controller.getModeStats();
    assert.strictEqual(stats.full_prompt, 1);
    assert.strictEqual(stats.delta, 1);
    assert.strictEqual(stats.stateless, 1);
  });
});
