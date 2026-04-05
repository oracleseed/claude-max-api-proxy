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

    // Always send full conversation — CLI has no memory between invocations.
    // Delta mode disabled: --print mode can't resume sessions (file locking).
    // The queue, registry, and gateway sync still provide value for tracking
    // and preventing concurrent session conflicts.
    this.modeStats.full_prompt++;
    this.log("full_prompt", agentKey, "continuation");
    return {
      mode: "full_prompt",
      sessionUUID: entry.sessionUUID,
      deltaMessages: null,
      reason: "continuation",
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
