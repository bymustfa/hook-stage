export class PointerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointerError";
  }
}

/** RFC 6901 JSON Pointer. Empty string addresses the whole document. */
export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new PointerError("JSON Pointer must be empty or start with /");
  }
  const tokens = pointer.split("/").slice(1);
  return tokens.map((token) => {
    if (token.includes("~") && !/^([^~]|~[01])*$/.test(token)) {
      throw new PointerError(`Invalid JSON Pointer escape in "${pointer}"`);
    }
    return token.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}

export function getByPointer(document: unknown, pointer: string): { found: boolean; value: unknown } {
  const tokens = parsePointer(pointer);
  let current = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false, value: undefined };
      const index = Number(token);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(record, token)) {
        return { found: false, value: undefined };
      }
      current = record[token];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

export function pointerLabel(pointer: string): string {
  const tokens = parsePointer(pointer);
  return tokens[tokens.length - 1] ?? (pointer || "(root)");
}
