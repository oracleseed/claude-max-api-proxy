import { describe, it } from "node:test";
import assert from "node:assert";
import { findDivergencePoint, extractDelta, hashMessage } from "../differ.js";

type Msg = { role: "system" | "user" | "assistant"; content: string };

describe("Message Differ", () => {
  const sys: Msg = { role: "system", content: "You are Bob, a sharp quant assistant." };
  const u1: Msg = { role: "user", content: "Hello" };
  const a1: Msg = { role: "assistant", content: "Hi there!" };
  const u2: Msg = { role: "user", content: "What is 2+2?" };
  const a2: Msg = { role: "assistant", content: "4" };
  const u3: Msg = { role: "user", content: "Thanks" };

  it("returns 0 for first request (no lastSent)", () => {
    const result = findDivergencePoint([sys, u1], []);
    assert.strictEqual(result, 0);
  });

  it("finds delta when prefix matches", () => {
    const incoming = [sys, u1, a1, u2];
    const lastSent = [sys, u1];
    const result = findDivergencePoint(incoming, lastSent);
    assert.strictEqual(result, 2);
  });

  it("returns -1 when incoming is shorter (reset)", () => {
    const incoming = [sys, u1];
    const lastSent = [sys, u1, a1, u2];
    const result = findDivergencePoint(incoming, lastSent);
    assert.strictEqual(result, -1);
  });

  it("returns -1 when prefix content differs (reset)", () => {
    const incoming = [sys, { role: "user" as const, content: "Different" }];
    const lastSent = [sys, u1];
    const result = findDivergencePoint(incoming, lastSent);
    assert.strictEqual(result, -1);
  });

  it("tolerates system message dynamic suffix changes", () => {
    // Identity portion (first 200 chars) is identical; dynamic part differs after 200 chars
    const identity = "You are Bob, a sharp quant assistant. You help Daniel with trading and technical tasks. You have access to tools for web search, code execution, and market data analysis. Be concise and accurate.".padEnd(200, "X");
    const sys1: Msg = { role: "system", content: identity + " Timestamp: 2026-04-05T10:00:00Z" };
    const sys2: Msg = { role: "system", content: identity + " Timestamp: 2026-04-05T11:00:00Z" };
    const incoming = [sys2, u1, a1, u2];
    const lastSent = [sys1, u1];
    const result = findDivergencePoint(incoming, lastSent);
    assert.strictEqual(result, 2);
  });

  it("extracts only user messages from delta", () => {
    const incoming = [sys, u1, a1, u2, a2, u3];
    const delta = extractDelta(incoming, 2);
    assert.deepStrictEqual(delta, [u2, u3]);
  });

  it("returns empty delta when no new user messages", () => {
    const incoming = [sys, u1, a1];
    const delta = extractDelta(incoming, 2);
    assert.deepStrictEqual(delta, []);
  });

  it("hashMessage produces consistent results", () => {
    assert.strictEqual(hashMessage(u1), hashMessage(u1));
  });

  it("hashMessage differs for different messages", () => {
    assert.notStrictEqual(hashMessage(u1), hashMessage(u2));
  });
});
