export const LIMITS = {
  name: 120,
  description: 500,
  events: 40,
  deliveries: 40,
  assertions: 20,
  bodyBytes: 32_000,
  scenarioBytes: 256_000,
  atMsMax: 600_000,
  timeoutMin: 200,
  timeoutMax: 30_000,
  pollMin: 50,
  pollMax: 5_000,
  pointer: 200,
  key: 40,
  concurrency: 4,
  deliveryTimeoutMs: 5_000,
  responseExcerpt: 8_000,
  observedState: 64_000,
} as const;

const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const PATH = /^\/[A-Za-z0-9._~/-]*$/;

export function isKey(value: string): boolean {
  return KEY.test(value);
}

export function isSafePath(value: string): boolean {
  if (!PATH.test(value)) return false;
  if (value.includes("//") || value.includes("..") || value.includes("\\")) return false;
  return true;
}
