#!/usr/bin/env node
import { consoleLoggers, isDirectExecution, parseArgs } from "./lib/cli.mjs";
import { VIDEOS_OUT_FILE } from "./lib/paths.mjs";
import { runUpdateVideos } from "./lib/update-videos.mjs";

const USAGE = `Usage: node scripts/update-videos.mjs [--out <file>] [--dry-run]

Refreshes public/videos.json from the YouTube Data API.
Environment: YOUTUBE_API_KEY (required), YOUTUBE_CHANNEL_ID, YOUTUBE_CHANNEL_HANDLE,
YOUTUBE_PLAYLIST_ID, YOUTUBE_MAX_RESULTS.`;

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

  const result = await runUpdateVideos({
    env,
    fetchImpl,
    now,
    outFile: options.outFile ?? VIDEOS_OUT_FILE,
    dryRun: options.dryRun,
    ...loggers,
  });

  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = (await main()).exitCode;
}
