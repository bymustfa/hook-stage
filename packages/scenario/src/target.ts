export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetError";
  }
}

export function assertLoopbackBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TargetError("Target URL is invalid");
  }
  if (url.username || url.password) throw new TargetError("Target URL must not include credentials");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetError("Target URL must be http or https");
  }
  if (url.search || url.hash) throw new TargetError("Target URL must not include a query or hash");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new TargetError("Put the webhook path on the profile, not in the base URL");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new TargetError("Only localhost targets are allowed");
  }
  return url;
}

export function joinLocalUrl(base: string, pathname: string): string {
  const url = assertLoopbackBaseUrl(base);
  if (!pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("..") || /[?#\\\s]/.test(pathname)) {
    throw new TargetError("Path is not allowed");
  }
  url.pathname = pathname;
  return url.toString();
}

export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const trimmed = hostHeader.trim().toLowerCase();
  const host = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]"))
    : trimmed.split(":")[0] ?? "";
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
