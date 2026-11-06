import { TargetError, joinLocalUrl } from "./target.js";
import type { HttpCallResult } from "./types.js";

const MAX_BODY = 64_000;

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Aborted");
}

export async function safeLocalRequest(options: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<HttpCallResult> {
  const url = joinLocalUrl(options.baseUrl, options.path);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(abortError()), options.timeoutMs);
  const onAbort = () => controller.abort(options.signal.reason ?? abortError());
  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: options.method,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "hook-stage",
      },
      body: options.method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    });
    const latencyMs = Date.now() - started;
    if (response.status >= 300 && response.status < 400) {
      return {
        outcome: "network_error",
        httpStatus: response.status,
        bodyText: "",
        latencyMs,
        error: "Redirect blocked",
        redirected: true,
      };
    }
    const bodyText = await readLimited(response);
    const outcome = response.status >= 200 && response.status < 300 ? "success" : "http_error";
    return {
      outcome,
      httpStatus: response.status,
      bodyText,
      latencyMs,
      ...(outcome === "http_error" ? { error: `HTTP ${response.status}` } : {}),
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (options.signal.aborted) throw abortError();
    if (controller.signal.aborted || isAbortError(error)) {
      return { outcome: "timeout", bodyText: "", latencyMs, error: "Request timed out" };
    }
    if (error instanceof TargetError) {
      return { outcome: "network_error", bodyText: "", latencyMs, error: error.message };
    }
    const message = error instanceof Error ? error.message : "Network error";
    return { outcome: "network_error", bodyText: "", latencyMs, error: message };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
  }
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (size < MAX_BODY) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  await reader.cancel().catch(() => undefined);
  return text.slice(0, MAX_BODY);
}
