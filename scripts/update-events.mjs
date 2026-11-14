#!/usr/bin/env node
import { consoleLoggers, isDirectExecution, parseArgs } from "./lib/cli.mjs";
import { EVENTS_OUT_FILE } from "./lib/paths.mjs";
import { runUpdateEvents } from "./lib/update-events.mjs";

const USAGE = `Usage: node scripts/update-events.mjs [--out <file>] [--dry-run]

Refreshes public/events.json from the start.gg API.
Environment: STARTGG_TOKEN (required for discovery), STARTGG_TOURNAMENT_SLUG,
STARTGG_SOURCE_URL, STARTGG_GRACE_HOURS, STARTGG_PER_PAGE, STARTGG_MAX_PAGES.`;

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ...rest
} = {}) {
  const loggers = { ...consoleLoggers(), ...rest };

  if (argv.includes("--help") || argv.includes("-h")) {
    loggers.log(USAGE);

    return { status: "help", exitCode: 0 };
  }

  let options;

  try {
    options = parseArgs(argv);
  } catch (error) {
    loggers.error(`${error.message}\n\n${USAGE}`);

    return { status: "failed", exitCode: 2 };
  }

  const result = await runUpdateEvents({
    env,
    fetchImpl,
    now,
    outFile: options.outFile ?? EVENTS_OUT_FILE,
    dryRun: options.dryRun,
    ...loggers,
  });

  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = (await main()).exitCode;
}
