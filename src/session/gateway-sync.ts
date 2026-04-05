/**
 * Gateway Sync — background WebSocket connection to OpenClaw gateway
 * for passive session state synchronization.
 */

import WebSocket from "ws";

export interface GatewayConfig {
  url: string;
  token: string;
}

export interface GatewaySyncCallbacks {
  url: string;
  token: string;
  onSessionReset: (sessionKey: string) => void;
  onSessionDelete: (sessionKey: string) => void;
  onSessionCompact: (sessionKey: string) => void;
  onConnectionChange: (connected: boolean) => void;
}

export function parseGatewayConfig(
  openclawJson: any
): GatewayConfig | null {
  const gw = openclawJson?.gateway;
  if (!gw?.port || !gw?.auth?.token) return null;

  const host = gw.bind === "loopback" ? "127.0.0.1" : gw.bind || "127.0.0.1";
  return {
    url: `ws://${host}:${gw.port}`,
    token: gw.auth.token,
  };
}

export class GatewaySync {
  private ws: WebSocket | null = null;
  private callbacks: GatewaySyncCallbacks;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reqId = 0;
  private _connected = false;
  private _shutdown = false;

  constructor(callbacks: GatewaySyncCallbacks) {
    this.callbacks = callbacks;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this._shutdown) return;

    try {
      this.ws = new WebSocket(this.callbacks.url);

      this.ws.on("open", () => {
        console.error("[GatewaySync] Connected to OpenClaw gateway");
        this._connected = true;
        this.reconnectDelay = 1000;
        this.callbacks.onConnectionChange(true);

        // Authenticate
        this.send({ type: "auth", token: this.callbacks.token });

        // Subscribe to session events
        this.send({
          type: "req",
          id: ++this.reqId,
          method: "sessions.subscribe",
          params: {},
        });
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // Ignore non-JSON messages
        }
      });

      this.ws.on("close", () => {
        this._connected = false;
        this.callbacks.onConnectionChange(false);
        console.error(
          `[GatewaySync] Disconnected, reconnecting in ${this.reconnectDelay}ms`
        );
        this.scheduleReconnect();
      });

      this.ws.on("error", (err: Error) => {
        console.error("[GatewaySync] WebSocket error:", err.message);
      });
    } catch (err) {
      console.error(
        "[GatewaySync] Connection failed:",
        (err as Error).message
      );
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: any): void {
    if (msg.type === "event" && msg.method?.startsWith("sessions.")) {
      const sessionKey =
        msg.params?.key || msg.params?.sessionKey;
      if (!sessionKey) return;

      if (msg.method === "sessions.changed") {
        const action = msg.params?.action;
        if (action === "reset") {
          console.error(`[GatewaySync] Session reset: ${sessionKey}`);
          this.callbacks.onSessionReset(sessionKey);
        } else if (action === "delete" || action === "removed") {
          console.error(`[GatewaySync] Session deleted: ${sessionKey}`);
          this.callbacks.onSessionDelete(sessionKey);
        } else if (action === "compact" || action === "compacted") {
          console.error(`[GatewaySync] Session compacted: ${sessionKey}`);
          this.callbacks.onSessionCompact(sessionKey);
        }
      }
    }
  }

  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(): void {
    if (this._shutdown) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  requestSessionList(): void {
    this.send({
      type: "req",
      id: ++this.reqId,
      method: "sessions.list",
      params: {},
    });
  }

  shutdown(): void {
    this._shutdown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }
}
