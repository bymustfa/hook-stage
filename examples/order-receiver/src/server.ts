import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createOrderBook, parseOrderEvent, type ReceiverMode } from "./orders.js";

export interface StartedReceiver {
  url: string;
  mode: ReceiverMode;
  close: () => Promise<void>;
  requests: Array<{ method: string; url: string }>;
}

export function startOrderReceiver(options: {
  mode: ReceiverMode;
  port?: number;
  host?: string;
  applyDelayMs?: number;
}): Promise<StartedReceiver> {
  const host = options.host ?? "127.0.0.1";
  const book = createOrderBook(options.mode, options.applyDelayMs ?? 30);
  const requests: Array<{ method: string; url: string }> = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "GET", url: url.pathname });
    try {
      if (request.method === "GET" && url.pathname === "/") {
        sendJson(response, 200, {
          service: "order-receiver",
          mode: options.mode,
          synthetic: true,
          webhookPath: "/webhooks/orders",
          statePath: "/__test/orders/:orderId",
          resetPath: "/__test/reset",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/__test/reset") {
        await readBody(request);
        book.reset();
        sendJson(response, 200, { reset: true });
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/__test/orders/")) {
        const orderId = decodeURIComponent(url.pathname.slice("/__test/orders/".length));
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) {
          sendJson(response, 400, { error: "Invalid order id" });
          return;
        }
        sendJson(response, 200, book.snapshot(orderId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/webhooks/orders") {
        const raw = await readBody(request);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw || "null");
        } catch {
          sendJson(response, 400, { error: "Invalid JSON" });
          return;
        }
        const event = parseOrderEvent(parsed);
        if (!event) {
          sendJson(response, 400, { error: "Event must include id, type, orderId, and version" });
          return;
        }
        sendJson(response, 200, book.accept(event));
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Receiver error" });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Receiver failed to bind"));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}`,
        mode: options.mode,
        requests,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64_000) {
        reject(new Error("Body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
