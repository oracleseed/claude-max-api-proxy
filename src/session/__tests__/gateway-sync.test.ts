import { describe, it } from "node:test";
import assert from "node:assert";
import { GatewaySync, parseGatewayConfig } from "../gateway-sync.js";

describe("Gateway Sync", () => {
  it("parses gateway config from openclaw.json", () => {
    const config = parseGatewayConfig({
      gateway: {
        port: 18789,
        bind: "loopback",
        auth: { mode: "token", token: "abc123" },
      },
    });
    assert.ok(config);
    assert.strictEqual(config!.url, "ws://127.0.0.1:18789");
    assert.strictEqual(config!.token, "abc123");
  });

  it("returns null config when gateway section missing", () => {
    const config = parseGatewayConfig({});
    assert.strictEqual(config, null);
  });

  it("returns null config when auth token missing", () => {
    const config = parseGatewayConfig({
      gateway: { port: 18789, bind: "loopback", auth: { mode: "none" } },
    });
    assert.strictEqual(config, null);
  });

  it("constructs GatewaySync with valid config", () => {
    const sync = new GatewaySync({
      url: "ws://127.0.0.1:18789",
      token: "test",
      onSessionReset: () => {},
      onSessionDelete: () => {},
      onSessionCompact: () => {},
      onConnectionChange: () => {},
    });
    assert.strictEqual(sync.isConnected, false);
  });

  it("handles 0.0.0.0 bind", () => {
    const config = parseGatewayConfig({
      gateway: {
        port: 9999,
        bind: "0.0.0.0",
        auth: { mode: "token", token: "xyz" },
      },
    });
    assert.ok(config);
    assert.strictEqual(config!.url, "ws://0.0.0.0:9999");
  });
});
