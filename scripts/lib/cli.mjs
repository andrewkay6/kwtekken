import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Shared option parsing for the thin CLI wrappers:
 *   --out <file>   write somewhere other than the checked-in public file
 *   --dry-run      report what would change without writing
 */
export function parseArgs(argv = []) {
  const options = { outFile: null, dryRun: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);

    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error("--out requires a file path");
      options.outFile = resolve(value);
      index += 1;
    } else if (arg.startsWith("--out=")) {
      options.outFile = resolve(arg.slice("--out=".length));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export function consoleLoggers() {
  return { log: console.log, warn: console.warn, error: console.error };
}

export function collectOutput() {
  const lines = [];
  const push = (stream) => (message) => lines.push(`${stream} ${message}`);

  return {
    lines,
    text: () => lines.join("\n"),
    loggers: { log: push("out"), warn: push("warn"), error: push("err") },
  };
}

export function isDirectExecution(importMetaUrl, entry = process.argv[1]) {
  if (!entry) return false;

  try {
    return pathToFileURL(resolve(entry)).href === importMetaUrl;
  } catch {
    return false;
  }
}
