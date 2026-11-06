import { isJsonObject } from "./json.js";
import { LIMITS, isKey, isSafePath } from "./limits.js";
import { parsePointer } from "./pointer.js";
import { FORMAT_VERSION, type Assertion, type Scenario, type Variant, type VariantId } from "./types.js";

export class ScenarioValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "ScenarioValidationError";
    this.errors = errors;
  }
}

export function validateScenario(input: unknown): Scenario {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);

  if (!isJsonObject(input)) {
    throw new ScenarioValidationError(["Scenario must be a JSON object"]);
  }

  const allowed = new Set([
    "formatVersion",
    "name",
    "description",
    "targetProfile",
    "events",
    "variants",
    "verification",
    "reset",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Unknown field "${key}"`);
  }

  if (input.formatVersion !== FORMAT_VERSION) {
    fail(`Unknown formatVersion. This version of hook-stage reads formatVersion ${FORMAT_VERSION}.`);
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.length > LIMITS.name) {
    fail(`name must be 1-${LIMITS.name} characters`);
  }

  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > LIMITS.description) {
      fail(`description must be a string up to ${LIMITS.description} characters`);
    }
  }

  if (typeof input.targetProfile !== "string" || !isKey(input.targetProfile)) {
    fail("targetProfile must be 1-40 characters of letters, numbers, _ or -");
  }

  const events = parseEvents(input.events, fail);
  const variants = parseVariants(input.variants, new Set(events.map((event) => event.key)), fail);
  const verification = input.verification === undefined ? undefined : parseVerification(input.verification, fail);
  const reset = input.reset === undefined ? undefined : parseReset(input.reset, fail);

  if (errors.length > 0) throw new ScenarioValidationError(errors);

  const scenario: Scenario = {
    formatVersion: FORMAT_VERSION,
    name: (input.name as string).trim(),
    targetProfile: input.targetProfile as string,
    events,
    variants: orderVariants(variants),
  };
  if (typeof input.description === "string" && input.description.trim()) {
    scenario.description = input.description.trim();
  }
  if (verification) scenario.verification = verification;
  if (reset) scenario.reset = reset;

  const encoded = JSON.stringify(scenario);
  if (encoded.length > LIMITS.scenarioBytes) {
    throw new ScenarioValidationError([`Scenario JSON exceeds ${LIMITS.scenarioBytes} bytes`]);
  }
  return scenario;
}

function parseEvents(value: unknown, fail: (message: string) => void) {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.events) {
    fail(`events must contain 1-${LIMITS.events} events`);
    return [];
  }
  const keys = new Set<string>();
  const events = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isJsonObject(item)) {
      fail(`events[${index}] must be an object`);
      continue;
    }
    for (const key of Object.keys(item)) {
      if (key !== "key" && key !== "body") fail(`events[${index}] has unknown field "${key}"`);
    }
    if (typeof item.key !== "string" || !isKey(item.key)) {
      fail(`events[${index}].key must be 1-40 characters of letters, numbers, _ or -`);
    } else if (keys.has(item.key)) {
      fail(`Duplicate event key "${item.key}"`);
    } else {
      keys.add(item.key);
    }
    if (item.body === undefined) {
      fail(`events[${index}].body is required`);
      continue;
    }
    let encoded = "";
    try {
      encoded = JSON.stringify(item.body);
    } catch {
      fail(`events[${index}].body is not JSON`);
      continue;
    }
    if (encoded === undefined || encoded.length > LIMITS.bodyBytes) {
      fail(`events[${index}].body exceeds ${LIMITS.bodyBytes} bytes`);
    }
    events.push({ key: String(item.key), body: item.body });
  }
  return events;
}

function parseVariants(value: unknown, eventKeys: Set<string>, fail: (message: string) => void): Variant[] {
  if (!Array.isArray(value)) {
    fail("variants must be an array with normal and modified flows");
    return [];
  }
  const seen = new Set<string>();
  const deliveryIds = new Set<string>();
  const variants: Variant[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isJsonObject(item)) {
      fail(`variants[${index}] must be an object`);
      continue;
    }
    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "deliveries") fail(`variants[${index}] has unknown field "${key}"`);
    }
    if (item.id !== "normal" && item.id !== "modified") {
      fail(`variants[${index}].id must be "normal" or "modified"`);
      continue;
    }
    if (seen.has(item.id)) fail(`Duplicate variant "${item.id}"`);
    seen.add(item.id);
    if (!Array.isArray(item.deliveries) || item.deliveries.length > LIMITS.deliveries) {
      fail(`variants[${index}].deliveries must be an array of at most ${LIMITS.deliveries}`);
      continue;
    }
    const deliveries = [];
    for (let deliveryIndex = 0; deliveryIndex < item.deliveries.length; deliveryIndex += 1) {
      const delivery = item.deliveries[deliveryIndex];
      const path = `variants[${index}].deliveries[${deliveryIndex}]`;
      if (!isJsonObject(delivery)) {
        fail(`${path} must be an object`);
        continue;
      }
      for (const key of Object.keys(delivery)) {
        if (key !== "id" && key !== "eventKey" && key !== "atMs") fail(`${path} has unknown field "${key}"`);
      }
      if (typeof delivery.id !== "string" || !isKey(delivery.id)) {
        fail(`${path}.id must be 1-40 characters of letters, numbers, _ or -`);
      } else if (deliveryIds.has(delivery.id)) {
        fail(`Duplicate delivery id "${delivery.id}"`);
      } else {
        deliveryIds.add(delivery.id);
      }
      if (typeof delivery.eventKey !== "string" || !eventKeys.has(delivery.eventKey)) {
        fail(`${path}.eventKey does not match an event`);
      }
      if (typeof delivery.atMs !== "number" || !Number.isInteger(delivery.atMs) || delivery.atMs < 0 || delivery.atMs > LIMITS.atMsMax) {
        fail(`${path}.atMs must be an integer from 0 to ${LIMITS.atMsMax}`);
      }
      deliveries.push({
        id: String(delivery.id),
        eventKey: String(delivery.eventKey),
        atMs: Number(delivery.atMs),
      });
    }
    variants.push({ id: item.id, deliveries });
  }
  if (!seen.has("normal") || !seen.has("modified")) {
    fail('variants must include both "normal" and "modified"');
  }
  if (value.length !== 2) fail("variants must contain exactly two flows");
  return variants;
}

function parseVerification(value: unknown, fail: (message: string) => void) {
  if (!isJsonObject(value)) {
    fail("verification must be an object");
    return undefined;
  }
  const allowed = new Set(["statePath", "readyWhen", "timeoutMs", "pollIntervalMs", "assertions"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`verification has unknown field "${key}"`);
  }
  if (typeof value.statePath !== "string" || !isSafePath(value.statePath)) {
    fail("verification.statePath must be a relative path starting with /");
  }
  if (!isJsonObject(value.readyWhen)) {
    fail("verification.readyWhen must be an object");
  } else {
    for (const key of Object.keys(value.readyWhen)) {
      if (key !== "pointer" && key !== "equals") fail(`verification.readyWhen has unknown field "${key}"`);
    }
    requirePointer(value.readyWhen.pointer, "verification.readyWhen.pointer", fail);
    if (!("equals" in value.readyWhen)) fail("verification.readyWhen.equals is required");
  }
  requireRange(value.timeoutMs, LIMITS.timeoutMin, LIMITS.timeoutMax, "verification.timeoutMs", fail);
  requireRange(value.pollIntervalMs, LIMITS.pollMin, LIMITS.pollMax, "verification.pollIntervalMs", fail);
  if (typeof value.timeoutMs === "number" && typeof value.pollIntervalMs === "number" && value.pollIntervalMs > value.timeoutMs) {
    fail("verification.pollIntervalMs cannot be greater than timeoutMs");
  }
  if (!Array.isArray(value.assertions) || value.assertions.length === 0 || value.assertions.length > LIMITS.assertions) {
    fail(`verification.assertions must contain 1-${LIMITS.assertions} checks`);
  }
  const assertions: Assertion[] = [];
  if (Array.isArray(value.assertions)) {
    for (let index = 0; index < value.assertions.length; index += 1) {
      const assertion = parseAssertion(value.assertions[index], index, fail);
      if (assertion) assertions.push(assertion);
    }
  }
  if (
    typeof value.statePath !== "string" ||
    !isJsonObject(value.readyWhen) ||
    typeof value.timeoutMs !== "number" ||
    typeof value.pollIntervalMs !== "number" ||
    assertions.length === 0
  ) {
    return undefined;
  }
  return {
    statePath: value.statePath,
    readyWhen: {
      pointer: String(value.readyWhen.pointer),
      equals: value.readyWhen.equals,
    },
    timeoutMs: value.timeoutMs,
    pollIntervalMs: value.pollIntervalMs,
    assertions,
  };
}

function parseAssertion(value: unknown, index: number, fail: (message: string) => void): Assertion | undefined {
  const path = `verification.assertions[${index}]`;
  if (!isJsonObject(value)) {
    fail(`${path} must be an object`);
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key !== "pointer" && key !== "operator" && key !== "expected") fail(`${path} has unknown field "${key}"`);
  }
  requirePointer(value.pointer, `${path}.pointer`, fail);
  if (value.operator !== "equals" && value.operator !== "exists") {
    fail(`${path}.operator must be "equals" or "exists"`);
    return undefined;
  }
  if (value.operator === "exists" && "expected" in value) {
    fail(`${path}.expected is not used with operator "exists"`);
  }
  if (value.operator === "equals" && !("expected" in value)) {
    fail(`${path}.expected is required for operator "equals"`);
  }
  if (typeof value.pointer !== "string") return undefined;
  if (value.operator === "exists") return { pointer: value.pointer, operator: "exists" };
  return { pointer: value.pointer, operator: "equals", expected: value.expected };
}

function parseReset(value: unknown, fail: (message: string) => void) {
  if (!isJsonObject(value)) {
    fail("reset must be an object");
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (key !== "method" && key !== "path" && key !== "body") fail(`reset has unknown field "${key}"`);
  }
  if (value.method !== "POST") fail('reset.method must be "POST"');
  if (typeof value.path !== "string" || !isSafePath(value.path)) {
    fail("reset.path must be a relative path starting with /");
  }
  if (value.body !== undefined) {
    try {
      JSON.stringify(value.body);
    } catch {
      fail("reset.body is not JSON");
    }
  }
  if (value.method !== "POST" || typeof value.path !== "string") return undefined;
  return value.body === undefined ? { method: "POST" as const, path: value.path } : { method: "POST" as const, path: value.path, body: value.body };
}

function requirePointer(value: unknown, label: string, fail: (message: string) => void) {
  if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.pointer) {
    fail(`${label} must be a JSON Pointer`);
    return;
  }
  try {
    parsePointer(value);
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : "invalid JSON Pointer"}`);
  }
}

function requireRange(value: unknown, min: number, max: number, label: string, fail: (message: string) => void) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}`);
  }
}

function orderVariants(variants: Variant[]): Variant[] {
  const normal = variants.find((variant) => variant.id === "normal");
  const modified = variants.find((variant) => variant.id === "modified");
  return [normal, modified].filter((variant): variant is Variant => Boolean(variant));
}

export function variantById(scenario: Scenario, variantId: VariantId): Variant {
  const variant = scenario.variants.find((item) => item.id === variantId);
  if (!variant) throw new ScenarioValidationError([`Unknown variant "${variantId}"`]);
  return variant;
}
