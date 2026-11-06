import type { Comparison, RunSummary, RunView, Scenario, VariantId } from "@hook-stage/scenario";

export interface Profile {
  id: string;
  label: string;
  baseUrl: string;
  webhookPath: string;
  updatedAt: string;
}

export interface ScenarioListItem {
  id: string;
  name: string;
  description: string;
  targetProfile: string;
  updatedAt: string;
  latest: { normal: RunSummary | null; modified: RunSummary | null };
}

export interface ScenarioDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  document: Scenario;
  history: RunSummary[];
  latestRuns: { normal: RunView | null; modified: RunView | null };
  comparison: Comparison;
}

export interface Client {
  token: string;
  listScenarios: () => Promise<ScenarioListItem[]>;
  getScenario: (id: string) => Promise<ScenarioDetail>;
  createScenario: (document: unknown) => Promise<ScenarioDetail>;
  saveScenario: (id: string, document: Scenario) => Promise<ScenarioDetail>;
  deleteScenario: (id: string) => Promise<void>;
  listProfiles: () => Promise<Profile[]>;
  saveProfile: (profile: Profile) => Promise<Profile>;
  startRun: (
    id: string,
    body: { variantId: VariantId; reset: boolean; targetProfileId: string },
  ) => Promise<RunView>;
  getRun: (id: string) => Promise<RunView>;
  cancelRun: (id: string) => Promise<void>;
  watchRun: (id: string, onRun: (run: RunView) => void, signal: AbortSignal) => Promise<void>;
}

export async function createClient(): Promise<Client> {
  const session = await fetch("/api/session");
  if (!session.ok) throw new Error("Could not start a local session");
  const { token } = (await session.json()) as { token: string };

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        "x-hook-stage-token": token,
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as { error?: string; details?: string[] };
    if (!response.ok) {
      const details = body.details?.length ? `\n${body.details.join("\n")}` : "";
      throw new Error(`${body.error ?? response.statusText}${details}`);
    }
    return body as T;
  }

  return {
    token,
    listScenarios: () => request("/api/scenarios"),
    getScenario: (id) => request(`/api/scenarios/${id}`),
    createScenario: (document) => request("/api/scenarios", { method: "POST", body: JSON.stringify(document) }),
    saveScenario: (id, document) => request(`/api/scenarios/${id}`, { method: "PUT", body: JSON.stringify(document) }),
    deleteScenario: (id) => request(`/api/scenarios/${id}`, { method: "DELETE" }),
    listProfiles: () => request("/api/profiles"),
    saveProfile: (profile) =>
      request(`/api/profiles/${profile.id}`, {
        method: "PUT",
        body: JSON.stringify({ label: profile.label, baseUrl: profile.baseUrl, webhookPath: profile.webhookPath }),
      }),
    startRun: (id, body) => request(`/api/scenarios/${id}/runs`, { method: "POST", body: JSON.stringify(body) }),
    getRun: (id) => request(`/api/runs/${id}`),
    cancelRun: (id) => request(`/api/runs/${id}/cancel`, { method: "POST" }),
    watchRun: (id, onRun, signal) => readEvents(`/api/runs/${id}/events`, token, onRun, signal),
  };
}

async function readEvents(path: string, token: string, onRun: (run: RunView) => void, signal: AbortSignal) {
  const response = await fetch(path, { headers: { "x-hook-stage-token": token }, signal });
  if (!response.ok || !response.body) throw new Error("Live run updates failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data.startsWith(":")) continue;
      onRun(JSON.parse(data) as RunView);
    }
  }
}
