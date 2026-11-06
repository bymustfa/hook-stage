import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runScenario, safeLocalRequest, validateScenario, type Scenario } from "@hook-stage/scenario";
import { createOrderBook } from "../examples/order-receiver/src/orders.ts";
import { startOrderReceiver } from "../examples/order-receiver/src/server.ts";

function fixture(name: string): Scenario {
  return validateScenario(JSON.parse(readFileSync(resolve("fixtures", name), "utf8")));
}

describe("order receiver state machine", () => {
  it("applies a duplicate payment twice in buggy mode and once in fixed mode", async () => {
    const buggy = createOrderBook("buggy", 0);
    buggy.accept({ id: "evt_paid", type: "order.paid", orderId: "order_demo", version: 1 });
    buggy.accept({ id: "evt_refund", type: "order.refunded", orderId: "order_demo", version: 2 });
    buggy.accept({ id: "evt_paid", type: "order.paid", orderId: "order_demo", version: 1 });
    await buggy.idle();
    expect(buggy.snapshot("order_demo")).toMatchObject({
      status: "paid",
      paymentApplications: 2,
      pendingJobs: 0,
    });

    const fixed = createOrderBook("fixed", 0);
    fixed.accept({ id: "evt_paid", type: "order.paid", orderId: "order_demo", version: 1 });
    fixed.accept({ id: "evt_refund", type: "order.refunded", orderId: "order_demo", version: 2 });
    fixed.accept({ id: "evt_paid", type: "order.paid", orderId: "order_demo", version: 1 });
    await fixed.idle();
    expect(fixed.snapshot("order_demo")).toMatchObject({
      status: "refunded",
      paymentApplications: 1,
      version: 2,
      pendingJobs: 0,
    });
    expect(fixed.snapshot("order_demo").ignoredEventIds).toEqual(["evt_paid"]);
  });

  it("keeps a newer refund when an older payment arrives later", async () => {
    const fixed = createOrderBook("fixed", 0);
    fixed.accept({ id: "evt_refund_rev", type: "order.refunded", orderId: "order_reverse", version: 2 });
    fixed.accept({ id: "evt_paid_rev", type: "order.paid", orderId: "order_reverse", version: 1 });
    await fixed.idle();
    expect(fixed.snapshot("order_reverse")).toMatchObject({ status: "refunded", version: 2, paymentApplications: 0 });

    const buggy = createOrderBook("buggy", 0);
    buggy.accept({ id: "evt_refund_rev", type: "order.refunded", orderId: "order_reverse", version: 2 });
    buggy.accept({ id: "evt_paid_rev", type: "order.paid", orderId: "order_reverse", version: 1 });
    await buggy.idle();
    expect(buggy.snapshot("order_reverse").status).toBe("paid");
  });
});

describe("scenario against the example receiver", () => {
  it("shows all 2xx and a business failure on the buggy receiver, then a pass on the fixed receiver", async () => {
    const scenario = fixture("delayed-duplicate-payment.json");
    const buggy = await startOrderReceiver({ mode: "buggy", applyDelayMs: 15 });
    const fixed = await startOrderReceiver({ mode: "fixed", applyDelayMs: 15 });
    try {
      const failed = await runScenario({
        scenario,
        variantId: "modified",
        baseUrl: buggy.url,
        webhookPath: "/webhooks/orders",
        resetRequested: true,
      });
      expect(failed.cleanStart).toBe(true);
      expect(failed.httpSummary).toBe("all 2xx");
      expect(failed.deliveries.every((delivery) => delivery.httpStatus === 200)).toBe(true);
      expect(failed.businessStatus).toBe("FAIL");
      expect(failed.headline).toContain("business FAILED");
      expect(failed.headline).toContain("paymentApplications expected 1, got 2");
      expect(failed.observedState).toMatchObject({ status: "paid", paymentApplications: 2 });

      const normal = await runScenario({
        scenario,
        variantId: "normal",
        baseUrl: buggy.url,
        webhookPath: "/webhooks/orders",
        resetRequested: true,
      });
      expect(normal.businessStatus).toBe("PASS");

      const passed = await runScenario({
        scenario,
        variantId: "modified",
        baseUrl: fixed.url,
        webhookPath: "/webhooks/orders",
        resetRequested: true,
      });
      expect(passed.httpSummary).toBe("all 2xx");
      expect(passed.businessStatus).toBe("PASS");
      expect(passed.observedState).toMatchObject({ status: "refunded", paymentApplications: 1 });
    } finally {
      await buggy.close();
      await fixed.close();
    }
  });

  it("blocks redirects instead of following them", async () => {
    let secretHits = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.url === "/secret") secretHits += 1;
      response.writeHead(302, { location: "/secret" });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    try {
      const result = await safeLocalRequest({
        baseUrl: `http://127.0.0.1:${address.port}`,
        path: "/hook",
        method: "POST",
        body: { id: "evt" },
        timeoutMs: 1000,
        signal: new AbortController().signal,
      });
      expect(result.redirected).toBe(true);
      expect(result.error).toBe("Redirect blocked");
      expect(secretHits).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
