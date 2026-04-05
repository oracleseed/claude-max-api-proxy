import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { RequestQueue } from "../queue.js";

describe("Request Queue", () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue({ maxWaitMs: 500, maxQueueSize: 3 });
  });

  it("executes immediately when idle", async () => {
    let executed = false;
    await queue.enqueue("agent-1", async () => {
      executed = true;
      return "ok";
    });
    assert.strictEqual(executed, true);
  });

  it("queues second request while first is running", async () => {
    const order: number[] = [];

    const p1 = queue.enqueue("agent-1", async () => {
      await new Promise((r) => setTimeout(r, 100));
      order.push(1);
      return "first";
    });

    const p2 = queue.enqueue("agent-1", async () => {
      order.push(2);
      return "second";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(order, [1, 2]);
    assert.strictEqual(r1, "first");
    assert.strictEqual(r2, "second");
  });

  it("allows concurrent requests for different agents", async () => {
    const order: string[] = [];

    const p1 = queue.enqueue("agent-1", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("a1");
      return "a1";
    });

    const p2 = queue.enqueue("agent-2", async () => {
      order.push("a2");
      return "a2";
    });

    await Promise.all([p1, p2]);
    assert.strictEqual(order[0], "a2");
  });

  it("rejects when queue is full", async () => {
    // 1 active + 3 waiting = 4, 5th should reject
    const blocker = queue.enqueue("agent-1", () =>
      new Promise((r) => setTimeout(r, 2000))
    );

    const waiters = Array.from({ length: 3 }, (_, i) =>
      queue.enqueue("agent-1", async () => `w${i}`)
    );

    await assert.rejects(
      queue.enqueue("agent-1", async () => "overflow"),
      { message: /queue full/i }
    );

    // Cleanup — don't let lingering promises crash
    blocker.catch(() => {});
    waiters.forEach((w) => w.catch(() => {}));
  });

  it("rejects on timeout", async () => {
    const blocker = queue.enqueue("agent-1", () =>
      new Promise((r) => setTimeout(r, 2000))
    );

    await assert.rejects(
      queue.enqueue("agent-1", async () => "too late"),
      { message: /timeout/i }
    );

    blocker.catch(() => {});
  });

  it("reports stats correctly", () => {
    const stats = queue.getStats("agent-1");
    assert.strictEqual(stats.active, false);
    assert.strictEqual(stats.waiting, 0);
  });
});
