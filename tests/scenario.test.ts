import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertLoopbackBaseUrl,
  compareRuns,
  duplicateDelivery,
  evaluateAssertions,
  getByPointer,
  moveDelivery,
  runScenario,
  validateScenario,
  type Scenario,
} from "@hook-stage/scenario";

const fixturePath = resolve("fixtures/delayed-duplicate-payment.json");
const reversedPath = resolve("fixtures/reversed-order.json");

function load(path: string): Scenario {
  return validateScenario(JSON.parse(readFileSync(path, "utf8")));
}

const success = {
  outcome: "success" as const,
  httpStatus: 200,
  bodyText: "{}",
  latencyMs: 1,
};

describe("scenario document", () => {
  it("accepts the payment fixture and rejects an unknown version", () => {
    const scenario = load(fixturePath);
    expect(scenario.variants.find((variant) => variant.id === "modified")?.deliveries).toHaveLength(3);
    expect(() => validateScenario({ ...scenario, formatVersion: 2 })).toThrow(/formatVersion/);
  });

  it("rejects a delivery that points at a missing event and a negative time", () => {
    const scenario = load(fixturePath);
    const broken = structuredClone(scenario) as Scenario;
    broken.variants[1]!.deliveries[0]!.eventKey = "missing";
    expect(() => validateScenario(broken)).toThrow(/eventKey/);
    const negative = structuredClone(scenario) as Scenario;
    negative.variants[0]!.deliveries[0]!.atMs = -1;
    expect(() => validateScenario(negative)).toThrow(/atMs/);
  });

  it("keeps the event id when a delivery is duplicated", () => {
    const scenario = duplicateDelivery(load(fixturePath), "modified", "d5");
    const modified = scenario.variants.find((variant) => variant.id === "modified");
    const paid = modified?.deliveries.filter((delivery) => delivery.eventKey === "paid") ?? [];
    expect(paid).toHaveLength(3);
    expect(new Set(paid.map((delivery) => delivery.id)).size).toBe(3);
    expect(scenario.events.find((event) => event.key === "paid")).toMatchObject({
      body: { id: "evt_paid" },
    });
  });

  it("moves a card into another time slot without cloning the event", () => {
    const scenario = moveDelivery(load(fixturePath), "modified", 2, 0);
    const modified = scenario.variants.find((variant) => variant.id === "modified");
    expect(modified?.deliveries.map((delivery) => [delivery.eventKey, delivery.atMs])).toEqual([
      ["paid", 0],
      ["paid", 300],
      ["refunded", 1500],
    ]);
  });
});

describe("json pointer and assertions", () => {
  it("reads escaped pointers and reports missing fields", () => {
    expect(getByPointer({ "a/b": { "~": 1 } }, "/a~1b/~0")).toEqual({ found: true, value: 1 });
    const [result] = evaluateAssertions({ status: "paid" }, [
      { pointer: "/paymentApplications", operator: "equals", expected: 1 },
    ]);
    expect(result?.passed).toBe(false);
    expect(result?.message).toBe("paymentApplications expected 1, got <missing>");
  });

  it("supports equals and exists and does not treat a missing field as success", () => {
    const results = evaluateAssertions({ status: "refunded", paymentApplications: 1, note: null }, [
      { pointer: "/status", operator: "equals", expected: "refunded" },
      { pointer: "/paymentApplications", operator: "equals", expected: 1 },
      { pointer: "/note", operator: "exists" },
      { pointer: "/missing", operator: "exists" },
    ]);
    expect(results.map((result) => result.passed)).toEqual([true, true, true, false]);
  });
});

describe("scheduler", () => {
  it("preserves the event id, waits for every delivery, and separates HTTP from business failure", async () => {
    const calls: string[] = [];
    let now = 0;
    const result = await runScenario({
      scenario: load(fixturePath),
      variantId: "modified",
      baseUrl: "http://127.0.0.1:3000",
      webhookPath: "/webhooks/orders",
      resetRequested: false,
      hooks: {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        sendWebhook: async ({ body }) => {
          calls.push(`post:${(body as { id: string }).id}`);
          return success;
        },
        readState: async () => {
          calls.push("get");
          return {
            outcome: "success",
            httpStatus: 200,
            bodyText: JSON.stringify({ pendingJobs: 0, status: "paid", paymentApplications: 2 }),
            latencyMs: 1,
          };
        },
      },
    });

    expect(calls).toEqual(["post:evt_paid", "post:evt_refund", "post:evt_paid", "get"]);
    expect(result.deliveries.map((delivery) => delivery.deliveryId)).toEqual(["d3", "d4", "d5"]);
    expect(result.deliveries.map((delivery) => delivery.actualAtMs)).toEqual([0, 300, 1500]);
    expect(result.httpSummary).toBe("all 2xx");
    expect(result.businessStatus).toBe("FAIL");
    expect(result.headline).toBe(
      'all 2xx; business FAILED: status expected "refunded", got "paid"; paymentApplications expected 1, got 2',
    );
    expect(result.assertions).toHaveLength(2);
    expect(result.assertions.every((assertion) => assertion.actual === "paid" || assertion.actual === 2)).toBe(true);
  });

  it("does not read business state before in-flight deliveries settle", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scenario = load(fixturePath);
    scenario.variants = scenario.variants.map((variant) =>
      variant.id === "modified"
        ? {
            ...variant,
            deliveries: [
              { id: "a", eventKey: "paid", atMs: 0 },
              { id: "b", eventKey: "refunded", atMs: 0 },
            ],
          }
        : variant,
    );

    const pending = runScenario({
      scenario,
      variantId: "modified",
      baseUrl: "http://127.0.0.1:3000",
      webhookPath: "/webhooks/orders",
      resetRequested: false,
      hooks: {
        sendWebhook: async () => {
          calls.push("post");
          await gate;
          return success;
        },
        readState: async () => {
          calls.push("get");
          return {
            outcome: "success",
            httpStatus: 200,
            bodyText: JSON.stringify({ pendingJobs: 0, status: "refunded", paymentApplications: 1 }),
            latencyMs: 1,
          };
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual(["post", "post"]);
    release?.();
    const result = await pending;
    expect(calls).toEqual(["post", "post", "get"]);
    expect(result.businessStatus).toBe("PASS");
  });

  it("evaluates every assertion against the same ready snapshot and times out without a false pass", async () => {
    const scenario = load(fixturePath);
    let reads = 0;
    let now = 0;
    const ready = await runScenario({
      scenario,
      variantId: "normal",
      baseUrl: "http://127.0.0.1:9",
      webhookPath: "/webhooks/orders",
      resetRequested: false,
      hooks: {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        sendWebhook: async () => success,
        readState: async () => {
          reads += 1;
          const readyState = reads >= 3;
          return {
            outcome: "success",
            httpStatus: 200,
            bodyText: JSON.stringify({
              pendingJobs: readyState ? 0 : 1,
              status: readyState ? "refunded" : "paid",
              paymentApplications: 1,
              generation: reads,
            }),
            latencyMs: 1,
          };
        },
      },
    });
    expect(ready.businessStatus).toBe("PASS");
    expect(ready.observedState).toMatchObject({ generation: 3, status: "refunded" });

    now = 0;
    const timedOut = await runScenario({
      scenario,
      variantId: "normal",
      baseUrl: "http://127.0.0.1:9",
      webhookPath: "/webhooks/orders",
      resetRequested: false,
      hooks: {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        sendWebhook: async () => success,
        readState: async () => ({
          outcome: "success",
          httpStatus: 200,
          bodyText: JSON.stringify({ pendingJobs: 1, status: "refunded", paymentApplications: 1 }),
          latencyMs: 1,
        }),
      },
    });
    expect(timedOut.businessStatus).toBe("TIMEOUT");
    expect(timedOut.assertions).toEqual([]);
    expect(timedOut.headline).toContain("business TIMEOUT");
  });

  it("cancels unsent deliveries and does not verify them", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    let now = 0;
    const result = await runScenario({
      scenario: load(fixturePath),
      variantId: "modified",
      baseUrl: "http://127.0.0.1:9",
      webhookPath: "/webhooks/orders",
      resetRequested: false,
      signal: controller.signal,
      hooks: {
        now: () => now,
        sleep: async (ms, signal) => {
          await Promise.resolve();
          if (signal.aborted) {
            const error = new Error("Aborted");
            error.name = "AbortError";
            throw error;
          }
          now += ms;
        },
        sendWebhook: async ({ body }) => {
          calls.push((body as { id: string }).id);
          controller.abort();
          return success;
        },
        readState: async () => {
          throw new Error("business check should not run");
        },
      },
    });
    expect(calls).toEqual(["evt_paid"]);
    expect(result.status).toBe("cancelled");
    expect(result.businessStatus).toBeNull();
    expect(result.deliveries.map((delivery) => delivery.outcome)).toEqual(["success", "cancelled", "cancelled"]);
  });

  it("does not send webhooks when the confirmed reset fails", async () => {
    let sent = 0;
    const result = await runScenario({
      scenario: load(fixturePath),
      variantId: "normal",
      baseUrl: "http://127.0.0.1:9",
      webhookPath: "/webhooks/orders",
      resetRequested: true,
      hooks: {
        sendWebhook: async () => {
          sent += 1;
          return success;
        },
        callReset: async () => ({ outcome: "http_error", httpStatus: 500, bodyText: "", latencyMs: 1, error: "HTTP 500" }),
      },
    });
    expect(sent).toBe(0);
    expect(result.status).toBe("reset_failed");
    expect(result.cleanStart).toBe(false);
  });

  it("marks a scenario with no verification as UNVERIFIED instead of passing it", async () => {
    const scenario = load(fixturePath);
    delete scenario.verification;
    const result = await runScenario({
      scenario,
      variantId: "normal",
      baseUrl: "http://127.0.0.1:9",
      webhookPath: "/webhooks/orders",
      resetRequested: false,
      hooks: { sendWebhook: async () => success },
    });
    expect(result.httpSummary).toBe("all 2xx");
    expect(result.businessStatus).toBe("UNVERIFIED");
  });
});

describe("comparison and targets", () => {
  it("refuses to call runs comparable without a clean start on the same target", () => {
    const base = {
      id: "r",
      variantId: "normal" as const,
      status: "completed" as const,
      cleanStart: true,
      targetBaseUrl: "http://127.0.0.1:3000",
      httpSummary: "all 2xx",
      businessStatus: "PASS" as const,
      businessMessage: "ok",
      headline: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
    };
    expect(compareRuns(base, { ...base, id: "m", variantId: "modified" }).comparable).toBe(true);
    expect(compareRuns(base, { ...base, id: "m", variantId: "modified", cleanStart: false }).comparable).toBe(false);
    expect(
      compareRuns(base, { ...base, id: "m", variantId: "modified", targetBaseUrl: "http://127.0.0.1:3001" }).reason,
    ).toMatch(/different receivers/);
  });

  it("allows only loopback base URLs", () => {
    expect(assertLoopbackBaseUrl("http://127.0.0.1:3000").hostname).toBe("127.0.0.1");
    expect(assertLoopbackBaseUrl("http://localhost:3000").hostname).toBe("localhost");
    expect(assertLoopbackBaseUrl("http://[::1]:3000").hostname.replace(/[[\]]/g, "")).toBe("::1");
    expect(() => assertLoopbackBaseUrl("http://example.com")).toThrow(/localhost/);
    expect(() => assertLoopbackBaseUrl("http://127.0.0.1:3000/hooks")).toThrow(/webhook path/);
    expect(() => assertLoopbackBaseUrl("http://user:pass@127.0.0.1:3000")).toThrow(/credentials/);
    expect(() => assertLoopbackBaseUrl("http://169.254.169.254")).toThrow(/localhost/);
  });
});

describe("fixture files", () => {
  it("loads the reversed-order fixture", () => {
    const scenario = load(reversedPath);
    expect(scenario.verification?.statePath).toBe("/__test/orders/order_reverse");
  });
});
