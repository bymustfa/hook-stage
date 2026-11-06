import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  compareRuns,
  headlineFor,
  httpSummary,
  validateScenario,
  type DeliveryView,
  type RunSummary,
  type RunView,
  type Scenario,
} from "@hook-stage/scenario";
import { findUp } from "./paths.js";

export type AppDatabase = Database.Database;

interface ScenarioRow {
  id: string;
  name: string;
  document: string;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  label: string;
  base_url: string;
  webhook_path: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  scenario_id: string;
  variant_id: "normal" | "modified";
  scenario_snapshot: string;
  profile_id: string;
  target_base_url: string;
  webhook_path: string;
  clean_start: number;
  reset_status: RunView["resetStatus"];
  status: RunView["status"];
  http_summary: string | null;
  business_status: RunView["businessStatus"];
  business_message: string | null;
  headline: string | null;
  observed_state: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

interface DeliveryRow {
  id: string;
  run_id: string;
  delivery_id: string;
  event_key: string;
  event_id: string | null;
  position: number;
  planned_at_ms: number;
  actual_at_ms: number | null;
  outcome: DeliveryView["outcome"];
  http_status: number | null;
  latency_ms: number | null;
  response_excerpt: string | null;
  error: string | null;
  request_body: string;
}

interface AssertionRow {
  id: string;
  run_id: string;
  position: number;
  pointer: string;
  operator: "equals" | "exists";
  expected_json: string | null;
  actual_json: string | null;
  passed: number;
  message: string;
}

export interface Profile {
  id: string;
  label: string;
  baseUrl: string;
  webhookPath: string;
  updatedAt: string;
}

export function openDatabase(dbPath: string): AppDatabase {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  if (dbPath !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 3000");
  migrate(db);
  interruptRunning(db);
  seed(db);
  return db;
}

function migrate(db: AppDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      webhook_path TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL,
      scenario_snapshot TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      target_base_url TEXT NOT NULL,
      webhook_path TEXT NOT NULL,
      clean_start INTEGER NOT NULL,
      reset_status TEXT NOT NULL,
      status TEXT NOT NULL,
      http_summary TEXT,
      business_status TEXT,
      business_message TEXT,
      headline TEXT,
      observed_state TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS delivery_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      delivery_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      event_id TEXT,
      position INTEGER NOT NULL,
      planned_at_ms INTEGER NOT NULL,
      actual_at_ms INTEGER,
      outcome TEXT NOT NULL,
      http_status INTEGER,
      latency_ms INTEGER,
      response_excerpt TEXT,
      error TEXT,
      request_body TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assertion_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      pointer TEXT NOT NULL,
      operator TEXT NOT NULL,
      expected_json TEXT,
      actual_json TEXT,
      passed INTEGER NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_delivery_run ON delivery_results(run_id, position);
    CREATE INDEX IF NOT EXISTS idx_assertion_run ON assertion_results(run_id, position);
  `);
}

function interruptRunning(db: AppDatabase) {
  const now = new Date().toISOString();
  const running = db.prepare("SELECT id FROM runs WHERE status = 'running'").all() as Array<{ id: string }>;
  if (running.length === 0) return;
  const interruptDelivery = db.prepare(
    `UPDATE delivery_results
     SET outcome = 'interrupted', error = 'Server stopped before this delivery finished.'
     WHERE run_id = ? AND outcome IN ('pending', 'sending')`,
  );
  const interruptRun = db.prepare(
    `UPDATE runs
     SET status = 'interrupted', finished_at = ?, error = 'Server stopped before the run finished. It was not resumed.'
     WHERE id = ?`,
  );
  const tx = db.transaction(() => {
    for (const run of running) {
      interruptDelivery.run(run.id);
      interruptRun.run(now, run.id);
    }
  });
  tx();
}

function seed(db: AppDatabase) {
  const now = new Date().toISOString();
  const insertProfile = db.prepare(
    `INSERT INTO profiles (id, label, base_url, webhook_path, updated_at)
     VALUES (@id, @label, @baseUrl, @webhookPath, @updatedAt)
     ON CONFLICT(id) DO NOTHING`,
  );
  const profiles = [
    { id: "local-demo", label: "Buggy receiver", baseUrl: "http://127.0.0.1:3000", webhookPath: "/webhooks/orders", updatedAt: now },
    { id: "fixed-demo", label: "Fixed receiver", baseUrl: "http://127.0.0.1:3001", webhookPath: "/webhooks/orders", updatedAt: now },
  ];
  for (const profile of profiles) insertProfile.run(profile);

  const count = db.prepare("SELECT COUNT(*) AS count FROM scenarios").get() as { count: number };
  if (count.count > 0) return;
  const examples = [
    ["fixtures/delayed-duplicate-payment.json", "scn_delayed_duplicate"],
    ["fixtures/reversed-order.json", "scn_reversed_order"],
  ] as const;
  const insert = db.prepare(
    `INSERT INTO scenarios (id, name, document, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [relative, id] of examples) {
    const file = findUp(relative);
    if (!file) continue;
    try {
      const scenario = validateScenario(JSON.parse(readFileSync(file, "utf8")));
      insert.run(id, scenario.name, JSON.stringify(scenario), now, now);
    } catch (error) {
      console.error(`Skipped example ${relative}: ${error instanceof Error ? error.message : error}`);
    }
  }
}

export function listProfiles(db: AppDatabase): Profile[] {
  const rows = db.prepare("SELECT * FROM profiles ORDER BY id").all() as ProfileRow[];
  return rows.map(mapProfile);
}

export function getProfile(db: AppDatabase, id: string): Profile | null {
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | undefined;
  return row ? mapProfile(row) : null;
}

export function saveProfile(db: AppDatabase, profile: Profile): Profile {
  db.prepare(
    `INSERT INTO profiles (id, label, base_url, webhook_path, updated_at)
     VALUES (@id, @label, @baseUrl, @webhookPath, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       base_url = excluded.base_url,
       webhook_path = excluded.webhook_path,
       updated_at = excluded.updated_at`,
  ).run(profile);
  return profile;
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    webhookPath: row.webhook_path,
    updatedAt: row.updated_at,
  };
}

export function insertScenario(db: AppDatabase, id: string, scenario: Scenario, now: string) {
  db.prepare("INSERT INTO scenarios (id, name, document, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    scenario.name,
    JSON.stringify(scenario),
    now,
    now,
  );
}

export function updateScenario(db: AppDatabase, id: string, scenario: Scenario, now: string) {
  db.prepare("UPDATE scenarios SET name = ?, document = ?, updated_at = ? WHERE id = ?").run(
    scenario.name,
    JSON.stringify(scenario),
    now,
    id,
  );
}

export function deleteScenario(db: AppDatabase, id: string) {
  db.prepare("DELETE FROM scenarios WHERE id = ?").run(id);
}

export function getScenarioRow(db: AppDatabase, id: string): { id: string; createdAt: string; updatedAt: string; document: Scenario } | null {
  const row = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id) as ScenarioRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    document: JSON.parse(row.document) as Scenario,
  };
}

export function listScenarioRows(db: AppDatabase) {
  const rows = db.prepare("SELECT * FROM scenarios ORDER BY created_at ASC").all() as ScenarioRow[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    document: JSON.parse(row.document) as Scenario,
  }));
}

export function insertRun(
  db: AppDatabase,
  run: {
    id: string;
    scenarioId: string;
    variantId: "normal" | "modified";
    snapshot: Scenario;
    profile: Profile;
    startedAt: string;
  },
) {
  db.prepare(
    `INSERT INTO runs (
      id, scenario_id, variant_id, scenario_snapshot, profile_id, target_base_url, webhook_path,
      clean_start, reset_status, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'not_requested', 'running', ?)`,
  ).run(
    run.id,
    run.scenarioId,
    run.variantId,
    JSON.stringify(run.snapshot),
    run.profile.id,
    run.profile.baseUrl,
    run.profile.webhookPath,
    run.startedAt,
  );
}

export function syncDeliveries(db: AppDatabase, runId: string, deliveries: DeliveryView[]) {
  const snapshotRow = db.prepare("SELECT scenario_snapshot FROM runs WHERE id = ?").get(runId) as
    | { scenario_snapshot: string }
    | undefined;
  const snapshot = snapshotRow ? (JSON.parse(snapshotRow.scenario_snapshot) as Scenario) : null;
  const bodies = new Map(snapshot?.events.map((event) => [event.key, JSON.stringify(event.body ?? null)]) ?? []);
  const upsert = db.prepare(
    `INSERT INTO delivery_results (
      id, run_id, delivery_id, event_key, event_id, position, planned_at_ms, actual_at_ms,
      outcome, http_status, latency_ms, response_excerpt, error, request_body
    ) VALUES (
      @id, @runId, @deliveryId, @eventKey, @eventId, @position, @plannedAtMs, @actualAtMs,
      @outcome, @httpStatus, @latencyMs, @responseExcerpt, @error, @requestBody
    )
    ON CONFLICT(id) DO UPDATE SET
      position = excluded.position,
      planned_at_ms = excluded.planned_at_ms,
      actual_at_ms = excluded.actual_at_ms,
      outcome = excluded.outcome,
      http_status = excluded.http_status,
      latency_ms = excluded.latency_ms,
      response_excerpt = excluded.response_excerpt,
      error = excluded.error,
      event_id = excluded.event_id`,
  );
  const tx = db.transaction(() => {
    for (const delivery of deliveries) {
      upsert.run({
        id: `${runId}:${delivery.deliveryId}`,
        runId,
        deliveryId: delivery.deliveryId,
        eventKey: delivery.eventKey,
        eventId: delivery.eventId,
        position: delivery.position,
        plannedAtMs: delivery.plannedAtMs,
        actualAtMs: delivery.actualAtMs,
        outcome: delivery.outcome,
        httpStatus: delivery.httpStatus,
        latencyMs: delivery.latencyMs,
        responseExcerpt: delivery.responseExcerpt,
        error: delivery.error,
        requestBody: bodies.get(delivery.eventKey) ?? "null",
      });
    }
    if (deliveries.length > 0) {
      const summary = httpSummary(deliveries);
      db.prepare("UPDATE runs SET http_summary = ?, headline = ? WHERE id = ? AND status = 'running'").run(summary, summary, runId);
    }
  });
  tx();
}

export function finishRun(
  db: AppDatabase,
  runId: string,
  result: {
    cleanStart: boolean;
    resetStatus: RunView["resetStatus"];
    status: RunView["status"];
    httpSummary: string | null;
    businessStatus: RunView["businessStatus"];
    businessMessage: string | null;
    headline: string | null;
    observedState: unknown;
    error: string | null;
    deliveries: DeliveryView[];
    assertions: Array<{
      pointer: string;
      operator: "equals" | "exists";
      expected: unknown;
      actual: unknown;
      passed: boolean;
      message: string;
    }>;
  },
) {
  const finishedAt = new Date().toISOString();
  const observed = result.observedState === null || result.observedState === undefined ? null : JSON.stringify(result.observedState).slice(0, 64_000);
  syncDeliveries(db, runId, result.deliveries);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM assertion_results WHERE run_id = ?").run(runId);
    const insert = db.prepare(
      `INSERT INTO assertion_results (
        id, run_id, position, pointer, operator, expected_json, actual_json, passed, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    result.assertions.forEach((assertion, position) => {
      insert.run(
        `${runId}:a:${position}`,
        runId,
        position,
        assertion.pointer,
        assertion.operator,
        assertion.expected === undefined ? null : JSON.stringify(assertion.expected),
        assertion.actual === undefined ? null : JSON.stringify(assertion.actual),
        assertion.passed ? 1 : 0,
        assertion.message,
      );
    });
    db.prepare(
      `UPDATE runs SET
        clean_start = ?, reset_status = ?, status = ?, http_summary = ?, business_status = ?,
        business_message = ?, headline = ?, observed_state = ?, finished_at = ?, error = ?
       WHERE id = ?`,
    ).run(
      result.cleanStart ? 1 : 0,
      result.resetStatus,
      result.status,
      result.httpSummary,
      result.businessStatus,
      result.businessMessage,
      result.headline ?? headlineFor(result.httpSummary, result.businessStatus, result.businessMessage),
      observed,
      finishedAt,
      result.error,
      runId,
    );
  });
  tx();
}

export function getRun(db: AppDatabase, id: string): RunView | null {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  if (!row) return null;
  return mapRun(db, row);
}

export function listRuns(db: AppDatabase, scenarioId: string): RunSummary[] {
  const rows = db.prepare("SELECT * FROM runs WHERE scenario_id = ? ORDER BY started_at DESC LIMIT 40").all(scenarioId) as RunRow[];
  return rows.map(mapSummary);
}

export function scenarioDetail(db: AppDatabase, id: string) {
  const scenario = getScenarioRow(db, id);
  if (!scenario) return null;
  const history = listRuns(db, id);
  const latestNormal = history.find((run) => run.variantId === "normal") ?? null;
  const latestModified = history.find((run) => run.variantId === "modified") ?? null;
  return {
    ...scenario,
    history,
    latestRuns: {
      normal: latestNormal ? getRun(db, latestNormal.id) : null,
      modified: latestModified ? getRun(db, latestModified.id) : null,
    },
    comparison: compareRuns(latestNormal, latestModified),
  };
}

export function scenarioListItem(db: AppDatabase, id: string, document: Scenario, updatedAt: string) {
  const history = listRuns(db, id);
  return {
    id,
    name: document.name,
    description: document.description ?? "",
    targetProfile: document.targetProfile,
    updatedAt,
    latest: {
      normal: history.find((run) => run.variantId === "normal") ?? null,
      modified: history.find((run) => run.variantId === "modified") ?? null,
    },
  };
}

function mapSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    variantId: row.variant_id,
    status: row.status,
    cleanStart: row.clean_start === 1,
    targetBaseUrl: row.target_base_url,
    httpSummary: row.http_summary,
    businessStatus: row.business_status,
    businessMessage: row.business_message,
    headline: row.headline,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapRun(db: AppDatabase, row: RunRow): RunView {
  const deliveries = db.prepare("SELECT * FROM delivery_results WHERE run_id = ? ORDER BY position").all(row.id) as DeliveryRow[];
  const assertions = db.prepare("SELECT * FROM assertion_results WHERE run_id = ? ORDER BY position").all(row.id) as AssertionRow[];
  return {
    ...mapSummary(row),
    resetStatus: row.reset_status,
    scenarioId: row.scenario_id,
    profileId: row.profile_id,
    targetBaseUrl: row.target_base_url,
    webhookPath: row.webhook_path,
    observedState: row.observed_state ? (JSON.parse(row.observed_state) as unknown) : null,
    error: row.error,
    deliveries: deliveries.map((delivery) => ({
      deliveryId: delivery.delivery_id,
      eventKey: delivery.event_key,
      eventId: delivery.event_id,
      position: delivery.position,
      plannedAtMs: delivery.planned_at_ms,
      actualAtMs: delivery.actual_at_ms,
      outcome: delivery.outcome,
      httpStatus: delivery.http_status,
      latencyMs: delivery.latency_ms,
      responseExcerpt: delivery.response_excerpt,
      error: delivery.error,
    })),
    assertions: assertions.map((assertion) => ({
      position: assertion.position,
      pointer: assertion.pointer,
      operator: assertion.operator,
      expected: assertion.expected_json === null ? null : (JSON.parse(assertion.expected_json) as unknown),
      actual: assertion.actual_json === null ? null : (JSON.parse(assertion.actual_json) as unknown),
      passed: assertion.passed === 1,
      message: assertion.message,
    })),
    scenarioSnapshot: JSON.parse(row.scenario_snapshot) as Scenario,
  };
}
