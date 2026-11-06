import { startOrderReceiver } from "./server.js";
import type { ReceiverMode } from "./orders.js";

const mode = readMode(process.argv);
const port = readPort(process.argv);
const receiver = await startOrderReceiver({ mode, port, host: "127.0.0.1" });
console.log(`order-receiver (${mode}) ${receiver.url}`);

function readMode(argv: string[]): ReceiverMode {
  const index = argv.indexOf("--mode");
  const value = index >= 0 ? argv[index + 1] : "buggy";
  if (value !== "buggy" && value !== "fixed") {
    console.error("Use --mode buggy or --mode fixed");
    process.exit(1);
  }
  return value;
}

function readPort(argv: string[]): number {
  const index = argv.indexOf("--port");
  const value = index >= 0 ? Number(argv[index + 1]) : 3000;
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    console.error("--port must be an integer from 0 to 65535");
    process.exit(1);
  }
  return value;
}
