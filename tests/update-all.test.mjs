import assert from "node:assert/strict";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { PROJECT_ROOT } from "../scripts/lib/paths.mjs";
import { buildUpdateSummary } from "../scripts/lib/summary.mjs";
import { runUpdateAll } from "../scripts/update-all.mjs";
import { createStartggFetch, createYouTubeFetch } from "./helpers/api.mjs";
import { capture, fixedNow, hoursFromNow, makeSandbox } from "./helpers/sandbox.mjs";
import { ownedTournament, playlist, playlistItem, previousFeed, tournamentDetails } from "./fixtures/shapes.mjs";

const NOW = "2026-11-14T12:00:00.000Z";
const TOKEN = "startgg-secret-token-value";
const KEY = "youtube-secret-key-value";
const START_DATE = hoursFromNow(24 * 5);
const EVENTS_FILE = join(PROJECT_ROOT, "public", "events.json");
const VIDEOS_FILE = join(PROJECT_ROOT, "public", "videos.json");

const sandboxes = [];

after(async () => {
  await Promise.all(sandboxes.map((sandbox) => sandbox.cleanup()));
});

function eventsResult(overrides = {}) {
  return {
    status: "updated",
    exitCode: 0,
    outFile: EVENTS_FILE,
    changed: true,
    selected: { name: "Basement Brawl 11", startAt: Math.floor(Date.parse("2026-12-05T00:00:00Z") / 1000) },
    ...overrides,
  };
}

function videosResult(overrides = {}) {
  return {
    status: "updated",
    exitCode: 0,
    outFile: VIDEOS_FILE,
    changed: true,
    playlistTitle: "Basement Brawl #11",
    videoCount: 12,
    ...overrides,
  };
}

describe("buildUpdateSummary", () => {
  it("names the tournament, its date, the playlist and the video count", () => {
    const summary = buildUpdateSummary({ events: eventsResult(), videos: videosResult() });

    assert.match(summary, /events\s+updated\s+Basement Brawl 11 — 2026-12-05 — public\/events\.json changed/);
    assert.match(summary, /videos\s+updated\s+"Basement Brawl #11" — 12 videos — public\/videos\.json changed/);
    assert.match(summary, /Review the diff, then commit and push/);
  });

  it("reports per-file changes independently", () => {
    const summary = buildUpdateSummary({
      events: eventsResult({ changed: false }),
      videos: videosResult({ changed: false, videoCount: 1 }),
    });

    assert.match(summary, /events\.json unchanged/);
    assert.match(summary, /1 video —/);
    assert.match(summary, /videos\.json unchanged/);
    assert.match(summary, /Nothing changed\./);
  });

  it("calls out an embed-only refresh", () => {
    const summary = buildUpdateSummary({
      events: eventsResult({ status: "embed-only", changed: true }),
      videos: videosResult({ changed: false }),
    });

    assert.match(summary, /embed metadata updated/);
  });

  it("explains a missing key without hiding the checked-in data", () => {
    const summary = buildUpdateSummary({
      events: eventsResult({ status: "skipped", changed: false, selected: null }),
      videos: videosResult({ status: "skipped", changed: false, videoCount: 3, playlistTitle: null }),
    });

    assert.match(summary, /events\s+skipped/);
    assert.match(summary, /no feed available \(kept public\/events\.json\)/);
    assert.match(summary, /YOUTUBE_API_KEY not set \(kept public\/videos\.json\)/);
  });

  it("keeps going and flags a failure with its reason", () => {
    const summary = buildUpdateSummary({
      events: eventsResult({ status: "failed", changed: false, message: "start.gg returned HTTP 401" }),
      videos: videosResult({ status: "failed", changed: false, message: "playlist has no public videos" }),
    });

    assert.match(summary, /events\s+FAILED\s+start\.gg returned HTTP 401 \(kept public\/events\.json\)/);
    assert.match(summary, /playlist has no public videos \(kept public\/videos\.json\)/);
    assert.match(summary, /A step failed; its JSON file still holds the last good data\./);
  });

  it("never prints a secret value", () => {
    const summary = buildUpdateSummary(
      {
        events: eventsResult({ status: "failed", message: `bad token ${TOKEN}` }),
        videos: videosResult({ status: "failed", message: `bad key ${KEY}` }),
      },
      { env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY } },
    );

    assert.doesNotMatch(summary, new RegExp(TOKEN));
    assert.doesNotMatch(summary, new RegExp(KEY));
    assert.match(summary, /\[redacted\]/);
  });
});

describe("runUpdateAll", () => {
  function fetches() {
    return {
      startgg: createStartggFetch({
        tournamentPages: [[ownedTournament({ slug: "tournament/basement-brawl-11", startAt: START_DATE })]],
        details: tournamentDetails({ slug: "tournament/basement-brawl-11", startAt: START_DATE }),
      }),
      youtube: createYouTubeFetch({
        playlistPages: [[playlist("PL11", "Basement Brawl #11", 2)]],
        itemPages: [[{ items: [playlistItem("a", "Pool 1"), playlistItem("b", "Pool 2")] }]],
      }),
    };
  }

  it("runs both updaters and prints one summary", async () => {
    const sandbox = await makeSandbox({ events: previousFeed(), videos: {} });
    const captured = capture();
    const combined = async (url, init) => {
      const fetches_ = combined.routes;

      return String(url).includes("start.gg")
        ? fetches_.startgg(url, init)
        : fetches_.youtube(url, init);
    };

    combined.routes = fetches();

    const result = await runUpdateAll({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combined,
      now: fixedNow(NOW),
      eventsOutFile: sandbox.eventsFile,
      videosOutFile: sandbox.videosFile,
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.events.status, "updated");
    assert.equal(result.videos.status, "updated");
    assert.equal((await sandbox.readJson("events.json")).tournament.slug, "tournament/basement-brawl-11");
    assert.deepEqual((await sandbox.readJson("videos.json")).videoIds, ["a", "b"]);

    const text = captured.text();

    assert.match(text, /Update summary:/);
    assert.match(text, /Basement Brawl 11: T7 Edition/);
    assert.match(text, /"Basement Brawl #11" — 2 videos/);
    assert.doesNotMatch(text, new RegExp(TOKEN));
    assert.doesNotMatch(text, new RegExp(KEY));
    await sandbox.cleanup();
  });

  it("still updates the second file when the first API fails, and exits non-zero", async () => {
    const sandbox = await makeSandbox({ events: previousFeed(), videos: {} });
    const before = await sandbox.read("events.json");
    const routes = fetches();
    const failingStartgg = createStartggFetch({ http: { CurrentUser: 401 } });
    const combined = async (url, init) =>
      String(url).includes("start.gg") ? failingStartgg(url, init) : routes.youtube(url, init);

    const result = await runUpdateAll({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combined,
      now: fixedNow(NOW),
      eventsOutFile: sandbox.eventsFile,
      videosOutFile: sandbox.videosFile,
      ...capture().loggers,
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.events.status, "failed");
    assert.equal(result.videos.status, "updated");
    assert.equal(await sandbox.read("events.json"), before);
    assert.equal((await sandbox.readJson("videos.json")).playlistId, "PL11");
    await sandbox.cleanup();
  });

  it("exits 0 with both files untouched when there are no credentials", async () => {
    const sandbox = await makeSandbox({ events: previousFeed(), videos: { playlistId: "PL8", playlistTitle: "Basement Brawl #8", videoIds: ["a"] } });
    const eventsBefore = await sandbox.read("events.json");
    const videosBefore = await sandbox.read("videos.json");
    const fetches_ = createStartggFetch({ http: { embed: 500 } });
    const youtube = createYouTubeFetch({});
    const combined = async (url, init) =>
      String(url).includes("start.gg") ? fetches_(url, init) : youtube(url, init);

    const result = await runUpdateAll({
      env: {},
      fetchImpl: combined,
      now: fixedNow(NOW),
      eventsOutFile: sandbox.eventsFile,
      videosOutFile: sandbox.videosFile,
      ...capture().loggers,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.events.status, "embed-only");
    assert.equal(result.videos.status, "skipped");
    assert.equal(await sandbox.read("events.json"), eventsBefore);
    assert.equal(await sandbox.read("videos.json"), videosBefore);
    await sandbox.cleanup();
  });

  it("supports --dry-run and refuses --out", async () => {
    const { main } = await import("../scripts/update-all.mjs");
    const sandbox = await makeSandbox({ events: previousFeed(), videos: {} });
    const before = await Promise.all([sandbox.read("events.json"), sandbox.read("videos.json")]);
    const captured = capture();
    const result = await main({
      argv: ["--dry-run"],
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: (() => {
        const routes = fetches();
        const impl = (url, init) =>
          String(url).includes("start.gg") ? routes.startgg(url, init) : routes.youtube(url, init);

        return impl;
      })(),
      now: fixedNow(NOW),
      eventsOutFile: sandbox.eventsFile,
      videosOutFile: sandbox.videosFile,
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual([await sandbox.read("events.json"), await sandbox.read("videos.json")], before);

    const rejected = await main({ argv: ["--out", "somewhere.json"], ...capture().loggers });

    assert.equal(rejected.exitCode, 2);
    await sandbox.cleanup();
  });
});
