import {
  businessFromAssertions,
  evaluateAssertions,
  headlineFor,
  httpSummary,
  readyConditionMet,
  type AssertionEvaluation,
} from "./assertions.js";
import { eventSummary, sortDeliveries } from "./edit.js";
import { isAbortError, safeLocalRequest } from "./http.js";
import { LIMITS } from "./limits.js";
import { joinLocalUrl } from "./target.js";
import type { BusinessStatus, DeliveryView, HttpCallResult, ResetStatus, RunStatus, Scenario, VariantId } from "./types.js";
import { variantById } from "./validate.js";

export interface RunHooks {
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  sendWebhook: (input: { body: unknown; timeoutMs: number; signal: AbortSignal }) => Promise<HttpCallResult>;
  readState: (input: { timeoutMs: number; signal: AbortSignal }) => Promise<HttpCallResult>;
  callReset: (input: { body: unknown; timeoutMs: number; signal: AbortSignal }) => Promise<HttpCallResult>;
  onDeliveries: (deliveries: DeliveryView[]) => void;
}

export interface ScenarioRunResult {
  cleanStart: boolean;
  resetStatus: ResetStatus;
  status: Extract<RunStatus, "completed" | "cancelled" | "reset_failed" | "error">;
  httpSummary: string | null;
  businessStatus: BusinessStatus | null;
  businessMessage: string | null;
  headline: string | null;
  observedState: unknown;
  error: string | null;
  deliveries: DeliveryView[];
  assertions: AssertionEvaluation[];
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function copyDeliveries(deliveries: DeliveryView[]): DeliveryView[] {
  return deliveries.map((delivery) => ({ ...delivery }));
}

export async function runScenario(options: {
  scenario: Scenario;
  variantId: VariantId;
  baseUrl: string;
  webhookPath: string;
  resetRequested: boolean;
  signal?: AbortSignal;
  hooks?: Partial<RunHooks>;
}): Promise<ScenarioRunResult> {
  const signal = options.signal ?? new AbortController().signal;
  const hooks = createHooks(options.baseUrl, options.webhookPath, options.scenario, options.hooks);
  const empty = (patch: Partial<ScenarioRunResult>): ScenarioRunResult => ({
    cleanStart: false,
    resetStatus: "not_requested",
    status: "error",
    httpSummary: null,
    businessStatus: null,
    businessMessage: null,
    headline: null,
    observedState: null,
    error: null,
    deliveries: [],
    assertions: [],
    ...patch,
  });

  try {
    joinLocalUrl(options.baseUrl, options.webhookPath);
    if (options.scenario.verification) joinLocalUrl(options.baseUrl, options.scenario.verification.statePath);
    if (options.scenario.reset) joinLocalUrl(options.baseUrl, options.scenario.reset.path);
  } catch (error) {
    return empty({
      status: "error",
      error: error instanceof Error ? error.message : "Target rejected",
    });
  }

  let cleanStart = false;
  let resetStatus: ResetStatus = "not_requested";
  if (options.resetRequested) {
    if (!options.scenario.reset) {
      return empty({
        status: "reset_failed",
        resetStatus: "not_defined",
        error: "No fixture reset hook is defined on this scenario.",
      });
    }
    try {
      const reset = await hooks.callReset({
        body: options.scenario.reset.body ?? {},
        timeoutMs: LIMITS.deliveryTimeoutMs,
        signal,
      });
      if (reset.outcome !== "success") {
        return empty({
          status: "reset_failed",
          resetStatus: "failed",
          error: reset.error ?? "Fixture reset failed",
        });
      }
      cleanStart = true;
      resetStatus = "succeeded";
    } catch (error) {
      if (isAbortError(error)) {
        return empty({ status: "cancelled", resetStatus: "failed", error: "Cancelled before the fixture reset finished." });
      }
      return empty({
        status: "reset_failed",
        resetStatus: "failed",
        error: error instanceof Error ? error.message : "Fixture reset failed",
      });
    }
  }

  const variant = variantById(options.scenario, options.variantId);
  const events = new Map(options.scenario.events.map((event) => [event.key, event.body]));
  const plan = sortDeliveries(variant.deliveries).map((delivery) => ({
    delivery,
    body: events.get(delivery.eventKey),
  }));
  const deliveries: DeliveryView[] = plan.map((item, position) => ({
    deliveryId: item.delivery.id,
    eventKey: item.delivery.eventKey,
    eventId: eventSummary(item.body).id,
    position,
    plannedAtMs: item.delivery.atMs,
    actualAtMs: null,
    outcome: "pending",
    httpStatus: null,
    latencyMs: null,
    responseExcerpt: null,
    error: null,
  }));
  const publish = () => hooks.onDeliveries(copyDeliveries(deliveries));
  publish();

  const runStartedAt = hooks.now();
  const slots = createSlots(LIMITS.concurrency);
  const inflight: Promise<void>[] = [];

  const cancelFrom = (index: number, message: string) => {
    for (let cursor = index; cursor < deliveries.length; cursor += 1) {
      const delivery = deliveries[cursor];
      if (!delivery) continue;
      if (delivery.outcome === "pending") {
        delivery.outcome = "cancelled";
        delivery.error = message;
      }
    }
  };

  try {
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      const delivery = deliveries[index];
      if (!item || !delivery) continue;
      if (signal.aborted) {
        cancelFrom(index, "Cancelled before send.");
        break;
      }
      const waitMs = Math.max(0, runStartedAt + item.delivery.atMs - hooks.now());
      try {
        if (waitMs > 0) await hooks.sleep(waitMs, signal);
      } catch (error) {
        if (isAbortError(error)) {
          cancelFrom(index, "Cancelled before send.");
          break;
        }
        throw error;
      }
      if (signal.aborted) {
        cancelFrom(index, "Cancelled before send.");
        break;
      }
      await slots.acquire(signal);
      delivery.outcome = "sending";
      delivery.actualAtMs = Math.max(0, Math.round(hooks.now() - runStartedAt));
      publish();
      const promise = Promise.resolve()
        .then(() =>
          hooks.sendWebhook({
            body: item.body,
            timeoutMs: LIMITS.deliveryTimeoutMs,
            signal,
          }),
        )
        .then((result) => {
          delivery.outcome = result.outcome;
          delivery.httpStatus = result.httpStatus ?? null;
          delivery.latencyMs = result.latencyMs;
          delivery.responseExcerpt = result.bodyText ? result.bodyText.slice(0, LIMITS.responseExcerpt) : null;
          delivery.error = result.error ?? null;
        })
        .catch((error: unknown) => {
          if (isAbortError(error) || signal.aborted) {
            delivery.outcome = "cancelled";
            delivery.error = "Cancelled. A request the target already accepted is not rolled back.";
          } else {
            delivery.outcome = "network_error";
            delivery.error = error instanceof Error ? error.message : "Network error";
          }
        })
        .finally(() => {
          slots.release();
          publish();
        });
      inflight.push(promise);
    }
  } catch (error) {
    if (!isAbortError(error)) {
      cancelFrom(0, "Stopped because a delivery could not be scheduled.");
      await Promise.all(inflight);
      return empty({
        status: "error",
        resetStatus,
        cleanStart,
        deliveries: copyDeliveries(deliveries),
        httpSummary: httpSummary(deliveries),
        error: error instanceof Error ? error.message : "Scheduler failed",
      });
    }
    cancelFrom(0, "Cancelled before send.");
  }

  await Promise.all(inflight);
  for (const delivery of deliveries) {
    if (delivery.outcome === "pending" || delivery.outcome === "sending") {
      delivery.outcome = "cancelled";
      delivery.error = "Not sent.";
    }
  }
  publish();

  const summary = httpSummary(deliveries);
  const cancelled = signal.aborted || deliveries.some((delivery) => delivery.outcome === "cancelled");
  if (cancelled) {
    return empty({
      status: "cancelled",
      resetStatus,
      cleanStart,
      deliveries: copyDeliveries(deliveries),
      httpSummary: summary,
      headline: summary,
      error: "Run cancelled. Sent requests are not rolled back, and business checks did not run.",
    });
  }

  try {
    const business = await verifyBusiness(options.scenario, hooks, signal);
    const line = headlineFor(summary, business.businessStatus, business.businessMessage);
    return empty({
      status: "completed",
      resetStatus,
      cleanStart,
      deliveries: copyDeliveries(deliveries),
      httpSummary: summary,
      businessStatus: business.businessStatus,
      businessMessage: business.businessMessage,
      headline: line,
      observedState: business.observedState,
      assertions: business.assertions,
      error: null,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return empty({
        status: "cancelled",
        resetStatus,
        cleanStart,
        deliveries: copyDeliveries(deliveries),
        httpSummary: summary,
        headline: summary,
        error: "Cancelled while reading business state. Sent requests are not rolled back.",
      });
    }
    return empty({
      status: "completed",
      resetStatus,
      cleanStart,
      deliveries: copyDeliveries(deliveries),
      httpSummary: summary,
      businessStatus: "CHECK_ERROR",
      businessMessage: error instanceof Error ? error.message : "Business check failed",
      headline: headlineFor(summary, "CHECK_ERROR", error instanceof Error ? error.message : "Business check failed"),
      error: null,
    });
  }
}

async function verifyBusiness(
  scenario: Scenario,
  hooks: RunHooks,
  signal: AbortSignal,
): Promise<{
  businessStatus: BusinessStatus;
  businessMessage: string;
  observedState: unknown;
  assertions: AssertionEvaluation[];
}> {
  const verification = scenario.verification;
  if (!verification) {
    return {
      businessStatus: "UNVERIFIED",
      businessMessage: "Business outcome was not verified. Add a state endpoint and assertions.",
      observedState: null,
      assertions: [],
    };
  }

  const started = hooks.now();
  let sawJson = false;
  let lastError = "State endpoint was not read";
  let lastDocument: unknown = null;

  while (hooks.now() - started <= verification.timeoutMs) {
    if (signal.aborted) throw abortError();
    const remaining = verification.timeoutMs - (hooks.now() - started);
    const result = await hooks.readState({
      timeoutMs: Math.min(LIMITS.deliveryTimeoutMs, Math.max(1, remaining)),
      signal,
    });
    if (result.outcome === "success") {
      try {
        const document: unknown = JSON.parse(result.bodyText || "null");
        sawJson = true;
        lastDocument = document;
        if (readyConditionMet(document, verification.readyWhen)) {
          const assertions = evaluateAssertions(document, verification.assertions);
          const business = businessFromAssertions(assertions);
          return {
            businessStatus: business.status,
            businessMessage: business.message,
            observedState: document,
            assertions,
          };
        }
      } catch {
        lastError = "State response is not JSON";
      }
    } else {
      lastError = result.error ?? `State endpoint returned HTTP ${result.httpStatus ?? "error"}`;
    }
    const left = verification.timeoutMs - (hooks.now() - started);
    if (left <= 0) break;
    await hooks.sleep(Math.min(verification.pollIntervalMs, left), signal);
  }

  if (!sawJson) {
    return {
      businessStatus: "CHECK_ERROR",
      businessMessage: lastError,
      observedState: null,
      assertions: [],
    };
  }
  return {
    businessStatus: "TIMEOUT",
    businessMessage: "Completion condition was not met before the timeout",
    observedState: lastDocument,
    assertions: [],
  };
}

function createHooks(baseUrl: string, webhookPath: string, scenario: Scenario, overrides: Partial<RunHooks> | undefined): RunHooks {
  const statePath = scenario.verification?.statePath ?? "/";
  const resetPath = scenario.reset?.path ?? "/";
  return {
    now: overrides?.now ?? Date.now,
    sleep: overrides?.sleep ?? delay,
    onDeliveries: overrides?.onDeliveries ?? (() => undefined),
    sendWebhook:
      overrides?.sendWebhook ??
      ((input) =>
        safeLocalRequest({
          baseUrl,
          path: webhookPath,
          method: "POST",
          body: input.body,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        })),
    readState:
      overrides?.readState ??
      ((input) =>
        safeLocalRequest({
          baseUrl,
          path: statePath,
          method: "GET",
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        })),
    callReset:
      overrides?.callReset ??
      ((input) =>
        safeLocalRequest({
          baseUrl,
          path: resetPath,
          method: "POST",
          body: input.body,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
        })),
  };
}

function createSlots(concurrency: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire(signal: AbortSignal) {
      if (signal.aborted) throw abortError();
      if (active < concurrency) {
        active += 1;
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const grant = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = waiters.indexOf(grant);
          if (index >= 0) waiters.splice(index, 1);
          reject(abortError());
        };
        waiters.push(grant);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    release() {
      active -= 1;
      const next = waiters.shift();
      if (next) {
        active += 1;
        next();
      }
    },
  };
}
