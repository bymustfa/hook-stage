import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateScenario, type Scenario } from "@hook-stage/scenario";
import { buildApp } from "../apps/server/src/app.ts";
import { startOrderReceiver } from "../examples/order-receiver/src/server.ts";

const scenario = validateScenario(JSON.parse(readFileSync("fixtures/delayed-duplicate-payment.json", "utf8")));

async function boot(dbName: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "hook-stage-"));
  const built = await buildApp({ dbPath: path.join(dir, dbName), logger: false, port: 8787 });
  const headers = { "x-hook-stage-token": built.token };
  return { ...built, headers, dir };
}

describe("local API", () => {
  it("imports a scenario without calling the target", async () => {
    const receiver = await startOrderReceiver({ mode: "buggy", applyDelayMs: 0 });
    const { app, headers } = await boot("import.db");
    try {
      const before = receiver.requests.length;
      const response = await app.inject({
        method: "POST",
        url: "/api/scenarios",
        headers,
        payload: scenario,
      });
      expect(response.statusCode).toBe(201);
      expect(receiver.requests.length).toBe(before);
      const body = response.json();
      expect(body.document.variants[1].deliveries).toHaveLength(3);
      expect(body.latestRuns.modified).toBeNull();
    } finally {
      await app.close();
      await receiver.close();
    }
  });

  it("rejects a non-loopback profile and a foreign origin", async () => {
    const { app, headers } = await boot("security.db");
    try {
      const remote = await app.inject({
        method: "PUT",
        url: "/api/profiles/local-demo",
        headers,
        payload: { label: "Remote", baseUrl: "https://example.com", webhookPath: "/hook" },
      });
      expect(remote.statusCode).toBe(400);

      const forged = await app.inject({
        method: "POST",
        url: "/api/scenarios",
        headers: { ...headers, origin: "https://evil.example" },
        payload: scenario,
      });
      expect(forged.statusCode).toBe(403);

      const anonymous = await app.inject({ method: "GET", url: "/api/scenarios" });
      expect(anonymous.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("stores a snapshot that later edits do not change", async () => {
    const receiver = await startOrderReceiver({ mode: "fixed", applyDelayMs: 5 });
    const { app, headers } = await boot("snapshot.db");
    try {
      await app.inject({
        method: "PUT",
        url: "/api/profiles/fixed-demo",
        headers,
        payload: { label: "Fixed receiver", baseUrl: receiver.url, webhookPath: "/webhooks/orders" },
      });
      const quick: Scenario = {
        ...scenario,
        variants: scenario.variants.map((variant) =>
          variant.id === "normal"
            ? { ...variant, deliveries: [{ id: "only", eventKey: "paid", atMs: 0 }] }
            : variant,
        ),
        verification: scenario.verification
          ? { ...scenario.verification, timeoutMs: 2000, pollIntervalMs: 50 }
          : undefined,
      };
      const created = await app.inject({ method: "POST", url: "/api/scenarios", headers, payload: quick });
      const id = created.json().id as string;
      const started = await app.inject({
        method: "POST",
        url: `/api/scenarios/${id}/runs`,
        headers,
        payload: { variantId: "normal", reset: true, targetProfileId: "fixed-demo" },
      });
      expect(started.statusCode).toBe(202);
      const runId = started.json().id as string;
      const finished = await waitFor(async () => {
        const run = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers });
        return run.json();
      });
      expect(finished.status).toBe("completed");
      expect(finished.scenarioSnapshot.events[0].body.id).toBe("evt_paid");

      const edited = structuredClone(quick) as Scenario;
      (edited.events[0]!.body as { id: string }).id = "evt_changed";
      edited.name = "Edited after the run";
      const saved = await app.inject({ method: "PUT", url: `/api/scenarios/${id}`, headers, payload: edited });
      expect(saved.statusCode).toBe(200);
      const again = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers });
      expect(again.json().scenarioSnapshot.name).toBe("Delayed duplicate payment");
      expect(again.json().scenarioSnapshot.events[0].body.id).toBe("evt_paid");
    } finally {
      await app.close();
      await receiver.close();
    }
  });

  it("runs the delayed duplicate against the buggy receiver and keeps HTTP apart from the business result", async () => {
    const receiver = await startOrderReceiver({ mode: "buggy", applyDelayMs: 10 });
    const { app, headers } = await boot("demo.db");
    try {
      await app.inject({
        method: "PUT",
        url: "/api/profiles/local-demo",
        headers,
        payload: { label: "Buggy receiver", baseUrl: receiver.url, webhookPath: "/webhooks/orders" },
      });
      const started = await app.inject({
        method: "POST",
        url: "/api/scenarios/scn_delayed_duplicate/runs",
        headers,
        payload: { variantId: "modified", reset: true, targetProfileId: "local-demo" },
      });
      expect(started.statusCode).toBe(202);
      const finished = await waitFor(async () => {
        const run = await app.inject({
          method: "GET",
          url: `/api/runs/${started.json().id}`,
          headers,
        });
        return run.json();
      });
      expect(finished.httpSummary).toBe("all 2xx");
      expect(finished.businessStatus).toBe("FAIL");
      expect(finished.headline).toContain("paymentApplications expected 1, got 2");
      expect(finished.cleanStart).toBe(true);
      expect(finished.deliveries.map((delivery: { eventId: string }) => delivery.eventId)).toEqual([
        "evt_paid",
        "evt_refund",
        "evt_paid",
      ]);
    } finally {
      await app.close();
      await receiver.close();
    }
  });

  it("cancels deliveries that have not been sent", async () => {
    const receiver = await startOrderReceiver({ mode: "fixed", applyDelayMs: 0 });
    const { app, headers } = await boot("cancel.db");
    try {
      await app.inject({
        method: "PUT",
        url: "/api/profiles/fixed-demo",
        headers,
        payload: { label: "Fixed", baseUrl: receiver.url, webhookPath: "/webhooks/orders" },
      });
      const slow: Scenario = {
        ...scenario,
        verification: undefined,
        variants: [
          { id: "normal", deliveries: [{ id: "soon", eventKey: "paid", atMs: 0 }, { id: "later", eventKey: "refunded", atMs: 4000 }] },
          { id: "modified", deliveries: [{ id: "m", eventKey: "paid", atMs: 0 }] },
        ],
      };
      const created = await app.inject({ method: "POST", url: "/api/scenarios", headers, payload: slow });
      const started = await app.inject({
        method: "POST",
        url: `/api/scenarios/${created.json().id}/runs`,
        headers,
        payload: { variantId: "normal", reset: true, targetProfileId: "fixed-demo" },
      });
      const runId = started.json().id as string;
      await waitUntil(async () => {
        const run = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers });
        const body = run.json();
        return body.deliveries.some((delivery: { outcome: string }) => delivery.outcome === "success");
      });
      const cancel = await app.inject({ method: "POST", url: `/api/runs/${runId}/cancel`, headers });
      expect(cancel.statusCode).toBe(200);
      const finished = await waitFor(async () => {
        const run = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers });
        return run.json();
      });
      expect(finished.status).toBe("cancelled");
      expect(finished.deliveries.map((delivery: { outcome: string }) => delivery.outcome)).toContain("cancelled");
      expect(receiver.requests.filter((request) => request.url === "/webhooks/orders").length).toBe(1);
    } finally {
      await app.close();
      await receiver.close();
    }
  });

  it("does not resume a run after the process restarts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hook-stage-"));
    const dbPath = path.join(dir, "restart.db");
    const first = await buildApp({ dbPath, logger: false });
    first.db
      .prepare(
        `INSERT INTO runs (
          id, scenario_id, variant_id, scenario_snapshot, profile_id, target_base_url, webhook_path,
          clean_start, reset_status, status, started_at
        ) VALUES (?, 'scn_delayed_duplicate', 'modified', '{}', 'local-demo', 'http://127.0.0.1:3000', '/webhooks/orders', 0, 'not_requested', 'running', ?)`,
      )
      .run("run_stuck", new Date().toISOString());
    first.db
      .prepare(
        `INSERT INTO delivery_results (
          id, run_id, delivery_id, event_key, position, planned_at_ms, outcome, request_body
        ) VALUES ('run_stuck:d3', 'run_stuck', 'd3', 'paid', 0, 0, 'pending', '{}')`,
      )
      .run();
    await first.app.close();

    const second = await buildApp({ dbPath, logger: false });
    try {
      const response = await second.app.inject({
        method: "GET",
        url: "/api/runs/run_stuck",
        headers: { "x-hook-stage-token": second.token },
      });
      expect(response.json().status).toBe("interrupted");
      expect(response.json().deliveries[0].outcome).toBe("interrupted");
    } finally {
      await second.app.close();
    }
  });
});

async function waitFor<T extends { status: string }>(read: () => Promise<T>): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const value = await read();
    if (value.status !== "running") return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for the run");
}

async function waitUntil(read: () => Promise<boolean>) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for a delivery");
}
