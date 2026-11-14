#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { consoleLoggers, isDirectExecution } from "./lib/cli.mjs";
import { PUBLIC_DIR } from "./lib/paths.mjs";
import { redactSecrets, collectSecretValues } from "./lib/secrets.mjs";
import { validateEventFeed, validateVideos } from "./lib/schema.mjs";
import { runUpdateEvents } from "./lib/update-events.mjs";
import { runUpdateVideos } from "./lib/update-videos.mjs";

const REQUIRED_ENV = ["STARTGG_TOKEN", "YOUTUBE_API_KEY"];

function isInsidePublic(target) {
  const resolved = resolve(target);

  return resolved === PUBLIC_DIR || resolved.startsWith(`${PUBLIC_DIR}/`);
}

function formatDate(unixSeconds) {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) return "date TBA";

  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Read-only live verification against the real start.gg and YouTube APIs.
 * Generated files go to a throwaway scratch directory, never to public/, and
 * every printed line is passed through secret redaction.
 */
export async function runLiveCheck(options = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    workDir = null,
    mkdtempImpl = mkdtemp,
    removeImpl = rm,
    ...rest
  } = options;

  const loggers = { ...consoleLoggers(), ...rest };
  const problems = [];
  const lines = [];
  const report = (message) => {
    const safe = redactSecrets(message, env);

    lines.push(safe);
    loggers.log(safe);
  };
  const addProblem = (message) => {
    const safe = redactSecrets(message, env);

    problems.push(safe);

    return safe;
  };

  const missing = REQUIRED_ENV.filter((name) => !String(env?.[name] ?? "").trim());

  if (missing.length) {
    addProblem(`live-check needs real API keys; missing ${missing.join(", ")}.`);
    problems.forEach((message) => report(`! ${message}`));

    return { exitCode: 1, problems, lines, workDir: null };
  }

  const created = !workDir;
  const dir = resolve(workDir ? workDir : await mkdtempImpl(join(tmpdir(), "kwtekken-live-check-")));
  const eventsFile = join(dir, "events.json");
  const videosFile = join(dir, "videos.json");

  if (isInsidePublic(dir) || isInsidePublic(eventsFile) || isInsidePublic(videosFile)) {
    addProblem(`refusing to use the scratch directory ${dir}: live-check never writes into public/`);
    report(`! ${problems[0]}`);

    return { exitCode: 1, problems, lines, workDir: dir };
  }

  report(`Live check (scratch dir: ${dir})`);

  const events = await runUpdateEvents({ env, fetchImpl, now, outFile: eventsFile, ...loggers });

  if (events.exitCode !== 0) {
    addProblem(`start.gg: ${events.message ?? "update failed"}`);
    report(`  start.gg: FAILED (${events.message ?? "update failed"})`);
  } else {
    const selected = events.selected ?? {};

    report(`  start.gg: ${selected.name || "unnamed tournament"} — ${formatDate(selected.startAt)}`);
    report(
      `           slug ${selected.slug || "n/a"} (${selected.kind || selected.source || "source n/a"})`,
    );
    report(`           url  ${selected.sourceUrl || "n/a"}`);
    report(`           ${events.feed?.events?.length ?? 0} event(s) in events.json`);
  }

  const videos = await runUpdateVideos({ env, fetchImpl, now, outFile: videosFile, ...loggers });

  if (videos.exitCode !== 0) {
    addProblem(`YouTube: ${videos.message ?? "update failed"}`);
    report(`  YouTube: FAILED (${videos.message ?? "update failed"})`);
  } else {
    report(`  YouTube: "${videos.playlistTitle || "untitled playlist"}" (${videos.playlistId})`);
    report(`           ${videos.videoCount ?? 0} public video(s) from ${videos.playlistSource ?? "channel"}`);
  }

  const checks = [
    { label: "events.json", file: eventsFile, validate: validateEventFeed },
    { label: "videos.json", file: videosFile, validate: validateVideos },
  ];

  for (const check of checks) {
    let raw = null;

    try {
      raw = await readFile(check.file, "utf8");
    } catch (error) {
      addProblem(`${check.label}: could not read the generated file (${error?.message ?? "error"})`);
      continue;
    }

    for (const secret of collectSecretValues(env)) {
      if (raw.includes(secret)) addProblem(`${check.label}: generated file contains a secret value`);
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch (error) {
      addProblem(`${check.label}: generated file is not valid JSON (${error?.message ?? "error"})`);
      continue;
    }

    const schemaProblems = check.validate(data);

    if (schemaProblems.length) {
      schemaProblems.forEach((entry) => addProblem(`${check.label}: ${entry}`));
      report(`  ${check.label} schema: INVALID (${redactSecrets(schemaProblems.join("; "), env)})`);
    } else {
      report(`  ${check.label} schema: OK (${Object.keys(data).join(", ")})`);
    }
  }

  if (created) {
    try {
      await removeImpl(dir, { recursive: true, force: true });
    } catch (error) {
      addProblem(`could not clean up ${dir}: ${error?.message ?? "error"}`);
    }
  }

  if (problems.length) {
    report(`Live check FAILED with ${problems.length} problem(s):`);
    problems.forEach((message) => loggers.error(redactSecrets(`  ! ${message}`, env)));
  } else {
    report("Live check passed. Only the checked-in public/ data would have to be regenerated.");
  }

  return {
    exitCode: problems.length ? 1 : 0,
    problems,
    lines: lines.map((line) => redactSecrets(line, env)),
    workDir: created ? null : dir,
    events,
    videos,
  };
}

export async function main(options = {}) {
  return runLiveCheck(options);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = (await main()).exitCode;
}
