import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  controlPlaneHealthSchema,
  validateControlPlaneSnapshot,
  type ControlPlaneHealth,
  type ControlPlaneSnapshot,
} from "../../../packages/runtime/src/control-plane.js";

const MAX_CONCURRENT_REQUESTS = 16;
const MAX_REQUEST_BYTES = 1_024;
const REQUEST_TIMEOUT_MS = 5_000;

export type ControlPlaneServerOptions = {
  host: "127.0.0.1" | "::1";
  port: number;
  allowedOrigins: readonly string[];
  health: () => ControlPlaneHealth | Promise<ControlPlaneHealth>;
  snapshot: () => ControlPlaneSnapshot | Promise<ControlPlaneSnapshot>;
};

export function createControlPlaneServer(options: ControlPlaneServerOptions): {
  server: Server;
  listen: () => Promise<number>;
  close: () => Promise<void>;
} {
  if (!["127.0.0.1", "::1"].includes(options.host)) {
    throw new Error("Control plane must bind to an explicit loopback host.");
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("Control-plane port is invalid.");
  }
  const allowedOrigins = new Set(options.allowedOrigins.map(validateOrigin));
  let activeRequests = 0;

  const server = createServer(async (request, response) => {
    activeRequests += 1;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setTimeout(REQUEST_TIMEOUT_MS, () => response.destroy());
    try {
      if (activeRequests > MAX_CONCURRENT_REQUESTS) {
        sendJson(response, 503, { error: "Control plane is busy." });
        return;
      }
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        sendJson(response, 403, { error: "Origin is not allowed." });
        return;
      }
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Read-only endpoint." });
        return;
      }
      if (requestBodyDeclared(request)) {
        sendJson(response, 413, { error: "Request body is not accepted." });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${options.host}`);
      if (url.pathname === "/api/v1/health") {
        sendJson(response, 200, controlPlaneHealthSchema.parse(await options.health()));
        return;
      }
      if (url.pathname === "/api/v1/snapshot") {
        sendJson(response, 200, validateControlPlaneSnapshot(await options.snapshot()));
        return;
      }
      sendJson(response, 404, { error: "Endpoint not found." });
    } catch {
      sendJson(response, 500, { error: "Local control-plane request failed." });
    } finally {
      activeRequests -= 1;
    }
  });

  return {
    server,
    listen: () =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen({ host: options.host, port: options.port, exclusive: true }, () => {
          server.off("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Control-plane address is unavailable."));
            return;
          }
          resolvePromise(address.port);
        });
      }),
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
        server.closeIdleConnections();
      }),
  };
}

function validateOrigin(origin: string): string {
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Allowed Studio origin must be an origin-only loopback URL.");
  }
  return url.origin;
}

function requestBodyDeclared(request: IncomingMessage): boolean {
  if (request.headers["transfer-encoding"]) return true;
  const rawLength = request.headers["content-length"];
  if (rawLength === undefined) return false;
  const length = Number(rawLength);
  return !Number.isSafeInteger(length) || length < 0 || length > MAX_REQUEST_BYTES || length > 0;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}
