import assert from "node:assert/strict";
import { mkdtemp } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { PUBLIC_DIR } from "../scripts/lib/paths.mjs";
import { runLiveCheck } from "../scripts/live-check.mjs";
import { createStartggFetch, createYouTubeFetch } from "./helpers/api.mjs";
import { capture, fixedNow, hoursFromNow } from "./helpers/sandbox.mjs";
import { ownedTournament, playlist, playlistItem, tournamentDetails } from "./fixtures/shapes.mjs";

const NOW = "2026-11-14T12:00:00.000Z";
const TOKEN = "startgg-secret-token-value";
const KEY = "youtube-secret-key-value";
const START_DATE = hoursFromNow(24 * 5);

const dirs = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix = "kwtekken-live-") {
  const dir = await mkdtempAsync(join(tmpdir(), prefix));

  dirs.push(dir);

  return dir;
}

function mkdtempAsync(...args) {
  return new Promise((done, fail) => mkdtemp(...args, (error, path) => (error ? fail(error) : done(path))));
}

function combinedFetch({ startgg, youtube } = {}) {
  const api = startgg ?? createStartggFetch({
    tournamentPages: [[ownedTournament({ slug: "tournament/basement-brawl-11", startAt: START_DATE })]],
    details: tournamentDetails({ slug: "tournament/basement-brawl-11", startAt: START_DATE }),
  });
  const tube = youtube ?? createYouTubeFetch({
    playlistPages: [[playlist("PL11", "Basement Brawl #11", 2)]],
    itemPages: [[{ items: [playlistItem("a", "Pool 1"), playlistItem("b", "Grand Finals")] }]],
  });
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(url);

    return String(url).includes("start.gg") ? api(url, init) : tube(url, init);
  };

  fetchImpl.calls = calls;

  return fetchImpl;
}

async function repoPublicSnapshot() {
  const read = async (name) => readFile(join(PUBLIC_DIR, name), "utf8");

  return { events: await read("events.json"), videos: await read("videos.json") };
}

async function fileExists(path) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

describe("live-check", () => {
  it("reports the chosen tournament and playlist and passes both schema checks", async () => {
    const dir = await tempDir();
    const captured = capture();
    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combinedFetch(),
      now: fixedNow(NOW),
      workDir: dir,
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 0, result.problems.join("; "));
    assert.deepEqual(result.problems, []);

    const text = captured.text();

    assert.match(text, /Live check \(scratch dir:/);
    assert.match(text, /start\.gg: Basement Brawl 11: T7 Edition — 2026-11-19/);
    assert.match(text, /slug tournament\/basement-brawl-11 \(upcoming\)/);
    assert.match(text, /url {2}https:\/\/www\.start\.gg\/tournament\/basement-brawl-11\/details/);
    assert.match(text, /2 event\(s\) in events\.json/);
    assert.match(text, /YouTube: "Basement Brawl #11" \(PL11\)/);
    assert.match(text, /2 public video\(s\) from discovered/);
    assert.match(text, /events\.json schema: OK \(sourceUrl, generatedAt, tournament, events\)/);
    assert.match(text, /videos\.json schema: OK \(generatedAt, playlistId, playlistTitle, videoIds\)/);
    assert.match(text, /Live check passed/);
    assert.equal(result.workDir, dir);
  });

  it("writes only into the scratch dir and leaves public/ untouched", async () => {
    const before = await repoPublicSnapshot();
    const dir = await tempDir();
    const fetchImpl = combinedFetch();

    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl,
      now: fixedNow(NOW),
      workDir: dir,
      ...capture().loggers,
    });

    assert.equal(result.exitCode, 0);

    const events = JSON.parse(await readFile(join(dir, "events.json"), "utf8"));
    const videos = JSON.parse(await readFile(join(dir, "videos.json"), "utf8"));

    assert.deepEqual(Object.keys(videos), ["generatedAt", "playlistId", "playlistTitle", "videoIds"]);
    assert.deepEqual(videos.videoIds, ["a", "b"]);
    assert.equal(events.tournament.slug, "tournament/basement-brawl-11");

    const after_ = await repoPublicSnapshot();

    assert.deepEqual(after_, before, "checked-in public/ data must not move");
    assert.equal(await fileExists(join(PUBLIC_DIR, "events.json.tmp")), false);
  });

  it("only sends read requests to the two APIs", async () => {
    const dir = await tempDir();
    const fetchImpl = combinedFetch();

    await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl,
      now: fixedNow(NOW),
      workDir: dir,
      ...capture().loggers,
    });

    const hosts = [...new Set(fetchImpl.calls.map((url) => new URL(String(url)).host))].sort();

    assert.deepEqual(hosts, ["api.start.gg", "www.googleapis.com", "www.start.gg"]);
  });

  it("creates a scratch dir and cleans it up again", async () => {
    const parent = await tempDir();
    const created = [];
    const removed = [];
    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combinedFetch(),
      now: fixedNow(NOW),
      mkdtempImpl: async (prefix) => {
        const dir = join(parent, "scratch");

        await mkdir(dir, { recursive: true });
        created.push(dir);

        return dir;
      },
      removeImpl: async (dir, options) => {
        removed.push(dir);

        return rm(dir, options);
      },
      ...capture().loggers,
    });

    assert.deepEqual(created, [join(parent, "scratch")]);
    assert.deepEqual(removed, created);
    assert.equal(result.workDir, null);
    assert.equal(result.exitCode, 0);
  });

  it("refuses a scratch dir inside public/", async () => {
    const captured = capture();
    const fetchImpl = combinedFetch();
    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl,
      now: fixedNow(NOW),
      workDir: join(PUBLIC_DIR, "scratch"),
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.problems.join(" "), /never writes into public\//);
    assert.equal(fetchImpl.calls.length, 0);
  });

  it("fails when a key is missing without calling anything", async () => {
    const captured = capture();
    const fetchImpl = combinedFetch();
    const result = await runLiveCheck({
      env: { YOUTUBE_API_KEY: KEY },
      fetchImpl,
      now: fixedNow(NOW),
      workDir: await tempDir(),
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.problems.join(" "), /missing STARTGG_TOKEN/);
    assert.match(captured.text(), /live-check needs real API keys/);
    assert.equal(fetchImpl.calls.length, 0);
    assert.doesNotMatch(captured.text(), new RegExp(KEY));
  });

  it("exits non-zero when start.gg fails", async () => {
    const captured = capture();
    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combinedFetch({ startgg: createStartggFetch({ http: { CurrentUser: 401 } }) }),
      now: fixedNow(NOW),
      workDir: await tempDir(),
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 1);
    assert.match(captured.text(), /start\.gg: FAILED/);
    assert.match(result.problems.join(" "), /start\.gg: /);
    assert.match(captured.text(), /Live check FAILED with/);
    assert.doesNotMatch(captured.text(), new RegExp(TOKEN));
  });

  it("exits non-zero when YouTube fails", async () => {
    const captured = capture();
    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combinedFetch({ youtube: createYouTubeFetch({ http: { channels: 403 } }) }),
      now: fixedNow(NOW),
      workDir: await tempDir(),
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 1);
    assert.match(captured.text(), /YouTube: FAILED/);
    assert.match(captured.text(), /videos\.json: (could not read|.*no such)/);
    assert.doesNotMatch(captured.text(), new RegExp(KEY));
  });

  it("never prints the token or key, even when the APIs echo them back", async () => {
    const captured = capture();
    const leaking = async (url) => {
      throw new Error(`connection reset while authenticating ${String(url).includes("start.gg") ? TOKEN : KEY}`);
    };

    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: leaking,
      now: fixedNow(NOW),
      workDir: await tempDir(),
      ...captured.loggers,
    });

    const text = `${captured.text()}\n${result.problems.join("\n")}\n${result.lines.join("\n")}`;

    assert.equal(result.exitCode, 1);
    assert.match(text, /\[redacted\]/);
    assert.doesNotMatch(text, new RegExp(TOKEN));
    assert.doesNotMatch(text, new RegExp(KEY));
  });

  it("reports a generated file it never got to write", async () => {
    const captured = capture();
    const result = await runLiveCheck({
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: KEY },
      fetchImpl: combinedFetch({ startgg: createStartggFetch({ graphqlErrors: { TournamentEvents: [{ message: "nope" }] } }) }),
      now: fixedNow(NOW),
      workDir: await tempDir(),
      ...captured.loggers,
    });

    assert.equal(result.exitCode, 1);
    assert.match(captured.text(), /events\.json: could not read the generated file/);
    assert.match(captured.text(), /videos\.json schema: OK/);
    assert.match(captured.text(), /Live check FAILED with 2 problem\(s\)/);
  });
});
