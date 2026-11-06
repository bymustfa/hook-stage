import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findUp(fileName: string): string | null {
  const starts = new Set<string>([process.cwd()]);
  let dir = process.cwd();
  for (let hop = 0; hop < 6; hop += 1) {
    starts.add(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  starts.add(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
  for (const start of starts) {
    const candidate = path.join(start, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function defaultDatabasePath(): string {
  const workspace = findUp("pnpm-workspace.yaml");
  const root = workspace ? path.dirname(workspace) : process.cwd();
  return path.join(root, ".hook-stage", "hook-stage.db");
}

export function publicDirectory(): string | null {
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public"),
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "apps/server/public"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}
