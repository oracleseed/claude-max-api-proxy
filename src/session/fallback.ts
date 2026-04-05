/**
 * Fallback Controller — central decision router for every request.
 * Determines whether to use delta, full_prompt, or stateless mode.
 */

import { SessionRegistry } from "./manager.js";
import { findDivergencePoint, extractDelta } from "./differ.js";

interface Message {
  role: string;
  content: string | unknown[];
}

export type ExecutionMode = "delta" | "full_prompt" | "stateless";

export interface Decision {
  mode: ExecutionMode;
  sessionUUID: string | null;
  deltaMessages: Message[] | null;
  reason: string;
}

export class FallbackController {
  private registry: SessionRegistry;
  private modeStats = { delta: 0, full_prompt: 0, stateless: 0 };

  constructor(registry: SessionRegistry) {
    this.registry = registry;
  }

  decide(
    agentKey: string,
    model: string,
    messages: Message[],
    gatewayConnected: boolean
  ): Decision {
    // Gate 1: Gateway must be connected
    if (!gatewayConnected) {
      this.modeStats.stateless++;
      this.log("stateless", agentKey, "gateway_disconnected");
      return {
        mode: "stateless",
        sessionUUID: null,
        deltaMessages: null,
        reason: "gateway_disconnected",
      };
    }

    // Gate 2: Check if existing entry is invalidated BEFORE getOrCreate replaces it
    const existingEntry = this.registry.get(agentKey);
    const wasInvalidated = existingEntry?.state === "invalidated";

    // Gate 3: Get or create session entry
    const entry = this.registry.getOrCreate(agentKey, model, messages);

    // Gate 4: Fresh entry (new or replaced after invalidation)
    if (entry.messagesRaw.length === 0 && entry.requestCount === 0) {
      const reason = wasInvalidated ? "invalidated" : "new_session";
      this.modeStats.full_prompt++;
      this.log("full_prompt", agentKey, reason);
      return {
        mode: "full_prompt",
        sessionUUID: entry.sessionUUID,
        deltaMessages: null,
        reason,
      };
    }

    // Gate 4: Message diff
    const divergeIndex = findDivergencePoint(messages, entry.messagesRaw);

    if (divergeIndex === -1) {
      // Prefix mismatch — reset
      this.registry.invalidate(agentKey);
      const newEntry = this.registry.getOrCreate(agentKey, model, messages);
      this.modeStats.full_prompt++;
      this.log("full_prompt", agentKey, "prefix_mismatch");
      return {
        mode: "full_prompt",
        sessionUUID: newEntry.sessionUUID,
        deltaMessages: null,
        reason: "prefix_mismatch",
      };
    }

    // Gate 5: Extract delta
    const delta = extractDelta(messages, divergeIndex);

    if (delta.length === 0) {
      this.modeStats.stateless++;
      this.log("stateless", agentKey, "no_new_messages");
      return {
        mode: "stateless",
        sessionUUID: null,
        deltaMessages: null,
        reason: "no_new_messages",
      };
    }

    // Success: delta mode
    this.modeStats.delta++;
    this.log("delta", agentKey, `${delta.length} new messages`);
    return {
      mode: "delta",
      sessionUUID: entry.sessionUUID,
      deltaMessages: delta,
      reason: "delta",
    };
  }

  getModeStats(): Record<string, number> {
    return { ...this.modeStats };
  }

  private log(mode: string, agentKey: string, reason: string): void {
    const shortKey = agentKey.slice(0, 8);
    console.error(`[Proxy] mode=${mode} agent=${shortKey} reason=${reason}`);
  }
}
