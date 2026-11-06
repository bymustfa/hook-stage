import { defaultDatabasePath } from "./paths.js";
import { startServer } from "./app.js";

const major = Number(process.versions.node.split(".")[0] ?? 0);
if (major < 22) {
  console.error("hook-stage requires Node.js 22 or newer");
  process.exit(1);
}

const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
  console.error("hook-stage only binds to a loopback host");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer from 1 to 65535");
  process.exit(1);
}

await startServer({
  port,
  host,
  dbPath: process.env.HOOK_STAGE_DB ?? defaultDatabasePath(),
});
