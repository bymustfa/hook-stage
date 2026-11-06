export const FORMAT_VERSION = 1;

export type VariantId = "normal" | "modified";

export type AssertionOperator = "equals" | "exists";

export type BusinessStatus = "PASS" | "FAIL" | "UNVERIFIED" | "CHECK_ERROR" | "TIMEOUT";

export type RunStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "reset_failed"
  | "error";

export type ResetStatus = "not_requested" | "succeeded" | "failed" | "not_defined";

export type DeliveryOutcome =
  | "pending"
  | "sending"
  | "success"
  | "http_error"
  | "timeout"
  | "network_error"
  | "cancelled"
  | "interrupted";

export interface ScenarioEvent {
  key: string;
  body: unknown;
}

export interface Delivery {
  id: string;
  eventKey: string;
  atMs: number;
}

export interface Variant {
  id: VariantId;
  deliveries: Delivery[];
}

export interface ReadyWhen {
  pointer: string;
  equals: unknown;
}

export interface Assertion {
  pointer: string;
  operator: AssertionOperator;
  expected?: unknown;
}

export interface Verification {
  statePath: string;
  readyWhen: ReadyWhen;
  timeoutMs: number;
  pollIntervalMs: number;
  assertions: Assertion[];
}

/** Explicit fixture reset. The runner calls it only when the user confirms a run. */
export interface ResetHook {
  method: "POST";
  path: string;
  body?: unknown;
}

/**
 * Portable scenario document. Machine-specific URLs live in target profiles,
 * not in this file.
 */
export interface Scenario {
  formatVersion: typeof FORMAT_VERSION;
  name: string;
  description?: string;
  targetProfile: string;
  events: ScenarioEvent[];
  variants: [Variant, Variant] | Variant[];
  verification?: Verification;
  reset?: ResetHook;
}

export interface HttpCallResult {
  outcome: "success" | "http_error" | "timeout" | "network_error";
  httpStatus?: number;
  bodyText: string;
  latencyMs: number;
  error?: string;
  redirected?: boolean;
}

export interface DeliveryView {
  deliveryId: string;
  eventKey: string;
  eventId: string | null;
  position: number;
  plannedAtMs: number;
  actualAtMs: number | null;
  outcome: DeliveryOutcome;
  httpStatus: number | null;
  latencyMs: number | null;
  responseExcerpt: string | null;
  error: string | null;
}

export interface AssertionView {
  position: number;
  pointer: string;
  operator: AssertionOperator;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  message: string;
}

export interface RunView {
  id: string;
  scenarioId: string;
  variantId: VariantId;
  profileId: string;
  targetBaseUrl: string;
  webhookPath: string;
  cleanStart: boolean;
  resetStatus: ResetStatus;
  status: RunStatus;
  httpSummary: string | null;
  businessStatus: BusinessStatus | null;
  businessMessage: string | null;
  headline: string | null;
  observedState: unknown;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  deliveries: DeliveryView[];
  assertions: AssertionView[];
  scenarioSnapshot: Scenario;
}

export interface RunSummary {
  id: string;
  variantId: VariantId;
  status: RunStatus;
  cleanStart: boolean;
  targetBaseUrl: string;
  httpSummary: string | null;
  businessStatus: BusinessStatus | null;
  businessMessage: string | null;
  headline: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Comparison {
  comparable: boolean;
  reason: string;
}
