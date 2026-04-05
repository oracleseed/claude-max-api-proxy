/**
 * Express HTTP Server
 *
 * Provides OpenAI-compatible API endpoints that wrap Claude Code CLI
 */

import express, { Express, Request, Response, NextFunction } from "express";
import { createServer, Server } from "http";
import fs from "fs/promises";
import { handleChatCompletions, handleModels, handleHealth, initSessionComponents } from "./routes.js";
import { SessionRegistry } from "../session/manager.js";
import { GatewaySync, parseGatewayConfig } from "../session/gateway-sync.js";
import { FallbackController } from "../session/fallback.js";
import { RequestQueue } from "../session/queue.js";

export interface ServerConfig {
  port: number;
  host?: string;
}

let serverInstance: Server | null = null;

/**
 * Create and configure the Express app
 */
function createApp(): Express {
  const app = express();

  // Middleware: use raw body parser + manual JSON parse for better error diagnostics
  app.use(express.raw({ type: "application/json", limit: "10mb" }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
      const raw = req.body.toString("utf8");
      if (process.env.DEBUG) {
        console.log("[Body raw]:", raw.substring(0, 200));
      }
      try {
        req.body = JSON.parse(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Body parse error]:", msg);
        if (process.env.DEBUG) {
          console.error("[Body raw]:", raw.substring(0, 300));
        } else {
          console.error("[Body metadata]:", {
            length: raw.length,
            method: req.method,
            url: req.originalUrl,
          });
        }
        return next(err);
      }
    }
    next();
  });

  // Request logging (debug mode)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (process.env.DEBUG) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    }
    next();
  });

  // CORS headers for local development
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  });

  // Handle OPTIONS preflight
  app.options("*", (_req: Request, res: Response) => {
    res.sendStatus(200);
  });

  // Routes
  app.get("/health", handleHealth);
  app.get("/v1/models", handleModels);
  app.post("/v1/chat/completions", handleChatCompletions);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: "Not found",
        type: "invalid_request_error",
        code: "not_found",
      },
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server Error]:", err.message);
    res.status(500).json({
      error: {
        message: err.message,
        type: "server_error",
        code: null,
      },
    });
  });

  return app;
}

/**
 * Start the HTTP server
 */
export async function startServer(config: ServerConfig): Promise<Server> {
  const { port, host = "127.0.0.1" } = config;

  if (serverInstance) {
    console.log("[Server] Already running, returning existing instance");
    return serverInstance;
  }

  const app = createApp();

  // Initialize session-aware components
  const homedir = process.env.HOME || "/tmp";
  const registry = new SessionRegistry({
    persistPath: `${homedir}/.claude-max-api-sessions-v2.json`,
  });
  await registry.loadFromDisk();

  const controller = new FallbackController(registry);
  const queue = new RequestQueue();
  let gatewayConnected = false;

  // Try to connect to OpenClaw gateway for session sync
  try {
    const configPath = `${homedir}/.openclaw/openclaw.json`;
    const raw = await fs.readFile(configPath, "utf-8");
    const gwConfig = parseGatewayConfig(JSON.parse(raw));
    if (gwConfig) {
      const sync = new GatewaySync({
        ...gwConfig,
        onSessionReset: (key) => {
          for (const entry of registry.getAll()) {
            if (entry.openclawSessionKey === key) {
              registry.invalidate(entry.agentKey);
            }
          }
        },
        onSessionDelete: (key) => {
          for (const entry of registry.getAll()) {
            if (entry.openclawSessionKey === key) {
              registry.remove(entry.agentKey);
            }
          }
        },
        onSessionCompact: (key) => {
          for (const entry of registry.getAll()) {
            if (entry.openclawSessionKey === key) {
              registry.invalidate(entry.agentKey);
            }
          }
        },
        onConnectionChange: (connected) => {
          gatewayConnected = connected;
        },
      });
      sync.connect();
      console.error("[Server] Gateway sync initialized");
    } else {
      console.error("[Server] No gateway config found, running stateless");
      gatewayConnected = true; // Allow session mode without gateway sync
    }
  } catch {
    console.error("[Server] Gateway sync unavailable, running stateless");
    gatewayConnected = true; // Allow session mode without gateway sync
  }

  // Inject components into routes
  initSessionComponents(registry, controller, queue, () => gatewayConnected);

  return new Promise((resolve, reject) => {
    serverInstance = createServer(app);

    serverInstance.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    serverInstance.listen(port, host, () => {
      console.log(`[Server] Claude Code CLI provider running at http://${host}:${port}`);
      console.log(`[Server] OpenAI-compatible endpoint: http://${host}:${port}/v1/chat/completions`);
      resolve(serverInstance!);
    });
  });
}

/**
 * Stop the HTTP server
 */
export async function stopServer(): Promise<void> {
  if (!serverInstance) {
    return;
  }

  return new Promise((resolve, reject) => {
    serverInstance!.close((err) => {
      if (err) {
        reject(err);
      } else {
        console.log("[Server] Stopped");
        serverInstance = null;
        resolve();
      }
    });
  });
}

/**
 * Get the current server instance
 */
export function getServer(): Server | null {
  return serverInstance;
}
