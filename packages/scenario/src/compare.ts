import type { Comparison, RunSummary } from "./types.js";

const SETTLED = new Set(["completed"]);

export function compareRuns(normal: RunSummary | null, modified: RunSummary | null): Comparison {
  if (!normal || !modified) {
    return { comparable: false, reason: "Run both the normal flow and the modified flow before comparing them." };
  }
  if (!SETTLED.has(normal.status) || !SETTLED.has(modified.status)) {
    return { comparable: false, reason: "Both flows need a finished run. Cancelled or interrupted runs are not compared." };
  }
  if (!normal.cleanStart || !modified.cleanStart) {
    return {
      comparable: false,
      reason: "These runs are not comparable. Confirm the fixture reset so both start from a clean state.",
    };
  }
  if (normal.targetBaseUrl !== modified.targetBaseUrl) {
    return {
      comparable: false,
      reason: "These runs targeted different receivers, so they are not a paired comparison.",
    };
  }
  return { comparable: true, reason: "Both runs confirmed the fixture reset against the same target." };
}
