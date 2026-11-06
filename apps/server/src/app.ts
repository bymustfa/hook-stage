import { randomBytes, timingSafeEqual } from "node:crypto";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ScenarioValidationError,
  isLoopbackHostHeader,
  joinLocalUrl,
  runScenario,
  validateScenario,
  type RunView,
  type Scenario,
  type VariantId,
} from "@hook-stage/scenario";
import {
  deleteScenario,
  finishRun,
  getProfile,
  getRun,
  insertRun,
  insertScenario,
  listProfiles,
  listScenarioRows,
  openDatabase,
  saveProfile,
  scenarioDetail,
  scenarioListItem,
  syncDeliveries,
  updateScenario,
  type AppDatabase,
  type Profile,
} from "./db.js";
import { defaultDatabasePath, publicDirectory } from "./paths.js";

const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const TERMINAL = new Set(["completed", "cancelled", "interrupted", "reset_failed", "error"]);

export interface BuiltApp {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
}

export async function buildApp(options: {
  dbPath?: string;
  sessionToken?: string;
  logger?: boolean;
  port?: number;
} = {}): Promise<BuiltApp> {
  const token = options.sessionToken ?? randomBytes(32).toString("hex");
  const listenPort = options.port ?? 8787;
  const db = openDatabase(options.dbPath ?? defaultDatabasePath());
  const app = Fastify({
    logger: options.logger ? { redact: ["req.headers.x-hook-stage-token"] } : false,
    bodyLimit: 512 * 1024,
  });

  const listeners = new Map<string, Set<(run: RunView) => void>>();
  const controllers = new Map<string, AbortController>();
  let activeRunId: string | null = null;

  const publish = (runId: string) => {
    const run = getRun(db, runId);
    if (!run) return;
    for (const listener of listeners.get(runId) ?? []) listener(run);
  };

  app.addHook("onRequest", (request, reply, done) => {
    if (!isLoopbackHostHeader(request.headers.host)) {
      reply.code(403).send({ error: "hook-stage only accepts loopback connections" });
      return;
    }
    done();
  });

  app.addHook("preHandler", (request, reply, done) => {
    const url = request.url.split("?")[0] ?? "";
    if (!url.startsWith("/api")) {
      done();
      return;
    }
    if (request.method === "GET" && (url === "/api/health" || url === "/api/session")) {
      done();
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && !originAllowed(origin, listenPort)) {
      reply.code(403).send({ error: "Origin is not allowed" });
      return;
    }
    const header = request.headers["x-hook-stage-token"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!tokensMatch(token, provided)) {
      reply.code(401).send({ error: "Missing session token" });
      return;
    }
    done();
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/session", async () => ({ token }));

  app.get("/api/profiles", async () => listProfiles(db));
  app.put<{ Params: { id: string }; Body: { label?: string; baseUrl?: string; webhookPath?: string } }>(
    "/api/profiles/:id",
    async (request, reply) => {
      if (!KEY.test(request.params.id)) return reply.code(400).send({ error: "Invalid profile id" });
      const label = (request.body?.label ?? request.params.id).trim();
      const baseUrl = request.body?.baseUrl ?? "";
      const webhookPath = request.body?.webhookPath ?? "";
      if (label.length === 0 || label.length > 80) return reply.code(400).send({ error: "Profile label is required" });
      try {
        joinLocalUrl(baseUrl, webhookPath);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid target" });
      }
      const profile: Profile = {
        id: request.params.id,
        label,
        baseUrl,
        webhookPath,
        updatedAt: new Date().toISOString(),
      };
      return saveProfile(db, profile);
    },
  );

  app.get("/api/scenarios", async () => {
    return listScenarioRows(db).map((scenario) => scenarioListItem(db, scenario.id, scenario.document, scenario.updatedAt));
  });

  app.post<{ Body: unknown }>("/api/scenarios", async (request, reply) => {
    const scenario = parseDocument(request.body);
    const id = `scn_${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    insertScenario(db, id, scenario, now);
    return reply.code(201).send(scenarioDetail(db, id));
  });

  app.get<{ Params: { id: string } }>("/api/scenarios/:id", async (request, reply) => {
    const detail = scenarioDetail(db, request.params.id);
    if (!detail) return reply.code(404).send({ error: "Scenario not found" });
    return detail;
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/scenarios/:id", async (request, reply) => {
    const existing = scenarioDetail(db, request.params.id);
    if (!existing) return reply.code(404).send({ error: "Scenario not found" });
    const scenario = parseDocument(request.body);
    updateScenario(db, request.params.id, scenario, new Date().toISOString());
    return scenarioDetail(db, request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/scenarios/:id", async (request, reply) => {
    const existing = scenarioDetail(db, request.params.id);
    if (!existing) return reply.code(404).send({ error: "Scenario not found" });
    if (activeRunId) {
      const active = getRun(db, activeRunId);
      if (active?.scenarioId === request.params.id) {
        return reply.code(409).send({ error: "This scenario has a run in progress" });
      }
    }
    deleteScenario(db, request.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string }; Body: { variantId?: VariantId; reset?: boolean; targetProfileId?: string } }>(
    "/api/scenarios/:id/runs",
    async (request, reply) => {
      const detail = scenarioDetail(db, request.params.id);
      if (!detail) return reply.code(404).send({ error: "Scenario not found" });
      const variantId = request.body?.variantId;
      if (variantId !== "normal" && variantId !== "modified") {
        return reply.code(400).send({ error: 'variantId must be "normal" or "modified"' });
      }
      const variant = detail.document.variants.find((item) => item.id === variantId);
      if (!variant || variant.deliveries.length === 0) {
        return reply.code(400).send({ error: "This flow has no deliveries" });
      }
      if (activeRunId) return reply.code(409).send({ error: "A run is already in progress" });

      const profileId = request.body?.targetProfileId || detail.document.targetProfile;
      const profile = getProfile(db, profileId);
      if (!profile) return reply.code(400).send({ error: `Target profile "${profileId}" is not configured on this machine` });
      try {
        joinLocalUrl(profile.baseUrl, profile.webhookPath);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid target" });
      }

      const runId = `run_${randomBytes(8).toString("hex")}`;
      const controller = new AbortController();
      activeRunId = runId;
      controllers.set(runId, controller);
      const snapshot = detail.document;
      insertRun(db, {
        id: runId,
        scenarioId: detail.id,
        variantId,
        snapshot,
        profile,
        startedAt: new Date().toISOString(),
      });

      void executeRun(runId, snapshot, variantId, profile, Boolean(request.body?.reset), controller).finally(() => {
        if (activeRunId === runId) activeRunId = null;
        controllers.delete(runId);
      });

      return reply.code(202).send(getRun(db, runId));
    },
  );

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = getRun(db, request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return run;
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (request, reply) => {
    const controller = controllers.get(request.params.id);
    if (!controller) return reply.code(409).send({ error: "This run is not in progress" });
    controller.abort();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", (request, reply) => {
    const current = getRun(db, request.params.id);
    if (!current) return reply.code(404).send({ error: "Run not found" });
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (run: RunView) => {
      if (raw.writableEnded) return;
      raw.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);
      if (TERMINAL.has(run.status)) raw.end();
    };
    const set = listeners.get(request.params.id) ?? new Set();
    set.add(send);
    listeners.set(request.params.id, set);
    send(current);
    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) raw.write(": ping\n\n");
    }, 15_000);
    const close = () => {
      clearInterval(heartbeat);
      set.delete(send);
    };
    request.raw.on("close", close);
    raw.on("close", close);
  });

  const assets = publicDirectory();
  if (assets) {
    await app.register(fastifyStatic, { root: assets });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ScenarioValidationError) {
      return reply.code(400).send({ error: "Scenario is invalid", details: error.errors });
    }
    const known = error as { statusCode?: number; message?: string };
    if (known.statusCode && known.statusCode < 500) {
      return reply.code(known.statusCode).send({ error: known.message ?? "Request failed" });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "Internal error" });
  });

  app.addHook("onClose", async () => {
    for (const controller of controllers.values()) controller.abort();
    db.close();
  });

  async function executeRun(
    runId: string,
    snapshot: Scenario,
    variantId: VariantId,
    profile: Profile,
    resetRequested: boolean,
    controller: AbortController,
  ) {
    try {
      const result = await runScenario({
        scenario: snapshot,
        variantId,
        baseUrl: profile.baseUrl,
        webhookPath: profile.webhookPath,
        resetRequested,
        signal: controller.signal,
        hooks: {
          onDeliveries(deliveries) {
            try {
              syncDeliveries(db, runId, deliveries);
              publish(runId);
            } catch (error) {
              app.log.error(error);
            }
          },
        },
      });
      finishRun(db, runId, result);
    } catch (error) {
      try {
        finishRun(db, runId, {
          cleanStart: false,
          resetStatus: "not_requested",
          status: "error",
          httpSummary: null,
          businessStatus: null,
          businessMessage: null,
          headline: null,
          observedState: null,
          error: error instanceof Error ? error.message : "Run failed",
          deliveries: [],
          assertions: [],
        });
      } catch (finishError) {
        app.log.error(finishError);
      }
    } finally {
      publish(runId);
    }
  }

  return { app, db, token };
}

export async function startServer(options: { port: number; host: string; dbPath?: string }) {
  const built = await buildApp({ logger: true, port: options.port, dbPath: options.dbPath });
  await built.app.listen({ port: options.port, host: options.host });
  built.app.log.info(`hook-stage listening on http://${options.host}:${options.port}`);
  return built;
}

function parseDocument(input: unknown): Scenario {
  if (input && typeof input === "object" && "document" in input) {
    return validateScenario((input as { document: unknown }).document);
  }
  return validateScenario(input);
}

function tokensMatch(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function originAllowed(origin: string, port: number): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return false;
    const originPort = url.port || (url.protocol === "https:" ? "443" : "80");
    return originPort === "5173" || originPort === "8787" || originPort === String(port);
  } catch {
    return false;
  }
}
