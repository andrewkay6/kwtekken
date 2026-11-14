#!/usr/bin/env node
import { consoleLoggers, isDirectExecution, parseArgs } from "./lib/cli.mjs";
import { EVENTS_OUT_FILE, VIDEOS_OUT_FILE } from "./lib/paths.mjs";
import { buildUpdateSummary } from "./lib/summary.mjs";
import { runUpdateEvents } from "./lib/update-events.mjs";
import { runUpdateVideos } from "./lib/update-videos.mjs";

const USAGE = `Usage: node scripts/update-all.mjs [--dry-run]

Runs both updaters against the real APIs using the local environment (or .env),
then prints a summary. Nothing is committed or pushed; review the diff and push
to deploy.

Environment: STARTGG_TOKEN, YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, YOUTUBE_PLAYLIST_ID,
STARTGG_TOURNAMENT_SLUG, STARTGG_SOURCE_URL.`;

/** Runs both updaters and reports what changed. Never touches git. */
export async function runUpdateAll(options = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    eventsOutFile = EVENTS_OUT_FILE,
    videosOutFile = VIDEOS_OUT_FILE,
    dryRun = false,
    ...rest
  } = options;

  const loggers = { ...consoleLoggers(), ...rest };

  const events = await runUpdateEvents({
    env,
    fetchImpl,
    now,
    outFile: eventsOutFile,
    dryRun,
    ...loggers,
  });
  const videos = await runUpdateVideos({
    env,
    fetchImpl,
    now,
    outFile: videosOutFile,
    dryRun,
    ...loggers,
  });

  loggers.log(buildUpdateSummary({ events, videos }, { env }));

  return {
    exitCode: events.exitCode || videos.exitCode ? 1 : 0,
    events,
    videos,
  };
}

export async function main(options = {}) {
  const loggers = { ...consoleLoggers(), ...options };
  let argv = options.argv ?? process.argv.slice(2);
  let parsed;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    loggers.error(`${error.message}\n\n${USAGE}`);

    return { exitCode: 2 };
  }

  if (parsed.help) {
    loggers.log(USAGE);

    return { exitCode: 0 };
  }

  if (parsed.outFile) {
    loggers.error(`update-all writes both checked-in files; use --out with the single updaters instead.\n\n${USAGE}`);

    return { exitCode: 2 };
  }

  return runUpdateAll({ ...options, argv: undefined, dryRun: parsed.dryRun });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = (await main()).exitCode;
}
