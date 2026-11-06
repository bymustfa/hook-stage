import { formatJsonValue, jsonEqual } from "./json.js";
import { getByPointer, pointerLabel } from "./pointer.js";
import type { Assertion, AssertionView, BusinessStatus, ReadyWhen } from "./types.js";

export interface AssertionEvaluation {
  pointer: string;
  operator: Assertion["operator"];
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}

export function readyConditionMet(document: unknown, readyWhen: ReadyWhen): boolean {
  const read = getByPointer(document, readyWhen.pointer);
  if (!read.found) return false;
  return jsonEqual(read.value, readyWhen.equals);
}

export function evaluateAssertions(document: unknown, assertions: Assertion[]): AssertionEvaluation[] {
  return assertions.map((assertion) => {
    const read = getByPointer(document, assertion.pointer);
    const label = pointerLabel(assertion.pointer);
    if (assertion.operator === "exists") {
      const passed = read.found;
      return {
        pointer: assertion.pointer,
        operator: assertion.operator,
        expected: undefined,
        actual: read.found ? read.value : undefined,
        passed,
        message: passed ? `${label} is present` : `${label} was not present`,
      };
    }
    const expected = assertion.expected;
    if (!read.found) {
      return {
        pointer: assertion.pointer,
        operator: "equals",
        expected,
        actual: undefined,
        passed: false,
        message: `${label} expected ${formatJsonValue(expected)}, got <missing>`,
      };
    }
    const passed = jsonEqual(read.value, expected);
    return {
      pointer: assertion.pointer,
      operator: "equals",
      expected,
      actual: read.value,
      passed,
      message: passed
        ? `${label} is ${formatJsonValue(expected)}`
        : `${label} expected ${formatJsonValue(expected)}, got ${formatJsonValue(read.value)}`,
    };
  });
}

export function businessFromAssertions(results: AssertionEvaluation[]): {
  status: Extract<BusinessStatus, "PASS" | "FAIL">;
  message: string;
} {
  const failed = results.filter((result) => !result.passed);
  if (failed.length === 0) {
    return { status: "PASS", message: "Business checks passed" };
  }
  return { status: "FAIL", message: failed.map((result) => result.message).join("; ") };
}

export function toAssertionViews(results: AssertionEvaluation[]): AssertionView[] {
  return results.map((result, position) => ({
    position,
    pointer: result.pointer,
    operator: result.operator,
    expected: result.expected ?? null,
    actual: result.actual === undefined ? null : result.actual,
    passed: result.passed,
    message: result.message,
  }));
}

export function httpSummary(outcomes: Array<{ outcome: string; httpStatus?: number | null }>): string {
  if (outcomes.length === 0) return "no deliveries";
  const all2xx = outcomes.every(
    (item) => item.outcome === "success" && typeof item.httpStatus === "number" && item.httpStatus >= 200 && item.httpStatus < 300,
  );
  if (all2xx) return "all 2xx";
  const timeouts = outcomes.filter((item) => item.outcome === "timeout").length;
  const network = outcomes.filter((item) => item.outcome === "network_error").length;
  const httpErrors = outcomes.filter((item) => item.outcome === "http_error").length;
  const cancelled = outcomes.filter((item) => item.outcome === "cancelled" || item.outcome === "interrupted").length;
  const pending = outcomes.filter((item) => item.outcome === "pending" || item.outcome === "sending").length;
  const parts: string[] = [];
  if (httpErrors) parts.push(`${httpErrors} non-2xx`);
  if (timeouts) parts.push(`${timeouts} timeout`);
  if (network) parts.push(`${network} network error`);
  if (cancelled) parts.push(`${cancelled} not sent`);
  if (pending) parts.push(`${pending} unfinished`);
  return parts.join(", ") || "HTTP incomplete";
}

export function headlineFor(
  http: string | null,
  businessStatus: BusinessStatus | null,
  businessMessage: string | null,
): string | null {
  if (!http && !businessStatus) return null;
  const delivery = http ?? "HTTP incomplete";
  if (!businessStatus) return delivery;
  if (businessStatus === "FAIL") return `${delivery}; business FAILED: ${businessMessage ?? "assertion failed"}`;
  if (businessStatus === "PASS") return `${delivery}; business PASS`;
  if (businessStatus === "UNVERIFIED") return `${delivery}; business UNVERIFIED`;
  if (businessStatus === "TIMEOUT") return `${delivery}; business TIMEOUT: ${businessMessage ?? "completion condition not met"}`;
  return `${delivery}; business CHECK_ERROR: ${businessMessage ?? "state endpoint could not be read"}`;
}
