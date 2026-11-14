import { relative } from "node:path";

import { PROJECT_ROOT } from "./paths.mjs";
import { collectSecretValues, redactValues } from "./secrets.mjs";

function shortPath(filePath) {
  if (typeof filePath !== "string" || !filePath) return "";

  const rel = relative(PROJECT_ROOT, filePath);

  return rel && !rel.startsWith("..") ? rel : filePath;
}

function label(status, { changed, dryRun }) {
  if (dryRun) return "dry run";

  switch (status) {
    case "updated":
      return changed ? "updated" : "unchanged";
    case "embed-only":
      return changed ? "embed metadata updated" : "unchanged";
    case "skipped":
      return "skipped";
    case "failed":
      return "FAILED";
    default:
      return status || "unknown";
  }
}

function pad(value, width) {
  const text = String(value);

  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function describeEvents(result, { fileLabel }) {
  if (!result) return { status: "not run", detail: `${fileLabel} untouched` };

  if (result.status === "failed") {
    return {
      status: label(result.status, result),
      detail: `${result.message ?? "start.gg update failed"} (kept ${fileLabel})`,
    };
  }

  if (result.status === "skipped") {
    return { status: label(result.status, result), detail: `no feed available (kept ${fileLabel})` };
  }

  const selected = result.selected ?? {};
  const date =
    typeof selected.startAt === "number"
      ? new Date(selected.startAt * 1000).toISOString().slice(0, 10)
      : "date TBA";

  return {
    status: label(result.status, result),
    detail: `${selected.name || "unknown tournament"} — ${date} — ${fileLabel} ${
      result.changed ? "changed" : "unchanged"
    }`,
  };
}

function describeVideos(result, { fileLabel }) {
  if (!result) return { status: "not run", detail: `${fileLabel} untouched` };

  if (result.status === "failed") {
    return {
      status: label(result.status, result),
      detail: `${result.message ?? "YouTube update failed"} (kept ${fileLabel})`,
    };
  }

  if (result.status === "skipped") {
    return {
      status: label(result.status, result),
      detail: `YOUTUBE_API_KEY not set (kept ${fileLabel})`,
    };
  }

  const count = result.videoCount ?? 0;

  return {
    status: label(result.status, result),
    detail: `${result.playlistTitle ? `"${result.playlistTitle}"` : "unknown playlist"} — ${count} video${
      count === 1 ? "" : "s"
    } — ${fileLabel} ${result.changed ? "changed" : "unchanged"}`,
  };
}

/**
 * Human summary of a local update run. Reports what got selected and whether
 * each checked-in file actually changed, ignoring generatedAt-only diffs.
 * Printed values are scrubbed of any credential passed in via env or secrets.
 */
export function buildUpdateSummary({ events, videos } = {}, { env, secrets } = {}) {
  const eventsFile = shortPath(events?.outFile) || "public/events.json";
  const videosFile = shortPath(videos?.outFile) || "public/videos.json";
  const eventLine = describeEvents(events, { fileLabel: eventsFile });
  const videoLine = describeVideos(videos, { fileLabel: videosFile });
  const lines = ["Update summary:", `  events  ${pad(eventLine.status, 22)}${eventLine.detail}`];

  lines.push(`  videos  ${pad(videoLine.status, 22)}${videoLine.detail}`);

  const failed = events?.status === "failed" || videos?.status === "failed";
  const changed = Boolean(events?.changed || videos?.changed);

  if (failed) {
    lines.push("  A step failed; its JSON file still holds the last good data.");
  } else if (changed) {
    lines.push("  Review the diff, then commit and push to deploy the new data.");
  } else {
    lines.push("  Nothing changed.");
  }

  return redactValues(lines.join("\n"), [...(Array.isArray(secrets) ? secrets : []), ...collectSecretValues(env)]);
}
