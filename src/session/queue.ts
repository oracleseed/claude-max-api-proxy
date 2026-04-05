/**
 * Request Queue — per-agent FIFO ensuring only one CLI subprocess
 * per session at a time. Others wait with timeout.
 */

export interface QueueOptions {
  maxWaitMs: number; // default 60000
  maxQueueSize: number; // default 5
}

interface QueueEntry<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface AgentQueue {
  active: boolean;
  waiting: QueueEntry<any>[];
}

export interface QueueStats {
  active: boolean;
  waiting: number;
}

export class RequestQueue {
  private agents = new Map<string, AgentQueue>();
  private opts: QueueOptions;

  constructor(opts: Partial<QueueOptions> = {}) {
    this.opts = {
      maxWaitMs: opts.maxWaitMs ?? 60_000,
      maxQueueSize: opts.maxQueueSize ?? 5,
    };
  }

  async enqueue<T>(agentKey: string, execute: () => Promise<T>): Promise<T> {
    let agent = this.agents.get(agentKey);
    if (!agent) {
      agent = { active: false, waiting: [] };
      this.agents.set(agentKey, agent);
    }

    if (!agent.active) {
      return this.run(agentKey, agent, execute);
    }

    if (agent.waiting.length >= this.opts.maxQueueSize) {
      throw new Error(
        `Queue full for agent ${agentKey} (${agent.waiting.length}/${this.opts.maxQueueSize})`
      );
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = agent!.waiting.findIndex((e) => e.resolve === resolve);
        if (idx !== -1) agent!.waiting.splice(idx, 1);
        reject(
          new Error(
            `Queue timeout for agent ${agentKey} after ${this.opts.maxWaitMs}ms`
          )
        );
      }, this.opts.maxWaitMs);

      agent!.waiting.push({
        execute,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timer,
      });
    });
  }

  private async run<T>(
    agentKey: string,
    agent: AgentQueue,
    execute: () => Promise<T>
  ): Promise<T> {
    agent.active = true;
    try {
      return await execute();
    } finally {
      agent.active = false;
      this.dequeue(agentKey, agent);
    }
  }

  private dequeue(agentKey: string, agent: AgentQueue): void {
    if (agent.waiting.length === 0) {
      if (!agent.active) this.agents.delete(agentKey);
      return;
    }

    const next = agent.waiting.shift()!;
    clearTimeout(next.timer);

    this.run(agentKey, agent, next.execute)
      .then(next.resolve)
      .catch(next.reject);
  }

  getStats(agentKey: string): QueueStats {
    const agent = this.agents.get(agentKey);
    return {
      active: agent?.active ?? false,
      waiting: agent?.waiting.length ?? 0,
    };
  }

  getAllStats(): Map<string, QueueStats> {
    const stats = new Map<string, QueueStats>();
    for (const [key, agent] of this.agents) {
      stats.set(key, { active: agent.active, waiting: agent.waiting.length });
    }
    return stats;
  }
}
