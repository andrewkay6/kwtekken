import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";

import { VIDEOS_KEYS } from "../scripts/lib/schema.mjs";
import { runUpdateVideos } from "../scripts/lib/update-videos.mjs";
import { createYouTubeFetch } from "./helpers/api.mjs";
import { capture, fixedNow, makeSandbox } from "./helpers/sandbox.mjs";
import { playlist, playlistItem, videoIds } from "./fixtures/shapes.mjs";

const CLI = resolve(import.meta.dirname, "../scripts/update-videos.mjs");
const NOW = "2026-11-14T12:00:00.000Z";
const KEY = "youtube-secret-key-value";

const sandboxes = [];

after(async () => {
  await Promise.all(sandboxes.map((sandbox) => sandbox.cleanup()));
});

async function sandboxWith(videos) {
  const sandbox = await makeSandbox({ videos: videos === undefined ? {} : videos });

  sandboxes.push(sandbox);

  return sandbox;
}

function run({ sandbox, env = {}, fetchImpl, options = {} } = {}) {
  const captured = capture();

  return runUpdateVideos({
    env: { YOUTUBE_API_KEY: KEY, ...env },
    fetchImpl: fetchImpl ?? createYouTubeFetch({}),
    now: fixedNow(NOW),
    outFile: sandbox.videosFile,
    ...captured.loggers,
    ...options,
  }).then((result) => Object.assign(result, { capture: captured }));
}

function healthyFetch({ items = [playlistItem("a", "Pool 1"), playlistItem("b", "Pool 2")], ...rest } = {}) {
  return createYouTubeFetch({
    playlistPages: [[playlist("PL10", "Basement Brawl #10", items.length)]],
    itemPages: [[{ items }]],
    ...rest,
  });
}

describe("update-videos: discovery", () => {
  it("writes the newest event playlist", async () => {
    const sandbox = await sandboxWith({ generatedAt: "2026-01-01T00:00:00.000Z", playlistId: "PL8", playlistTitle: "Basement Brawl #8", videoIds: ["old"] });
    const fetchImpl = createYouTubeFetch({
      channels: [{ id: "UCresolved" }],
      playlistPages: [[playlist("PL7", "Basement Brawl #7 (CAFÉ EDITION)", 20), playlist("PLvod", "Stream VODs", 200)]],
      itemPages: [[{ items: [playlistItem("a", "Pool 1"), playlistItem("b", "Pool 2"), playlistItem("c", "Private video"), playlistItem("d", "Deleted video")] }]],
    });
    const result = await run({ sandbox, fetchImpl });

    assert.equal(result.status, "updated");
    assert.equal(result.exitCode, 0);
    assert.equal(result.changed, true);
    assert.equal(result.videoCount, 2);
    assert.equal(result.playlistTitle, "Basement Brawl #7 (CAFÉ EDITION)");
    assert.deepEqual(await sandbox.readJson("videos.json"), {
      generatedAt: NOW,
      playlistId: "PL7",
      playlistTitle: "Basement Brawl #7 (CAFÉ EDITION)",
      videoIds: ["a", "b"],
    });
    assert.deepEqual(fetchImpl.endpoints(), ["channels", "playlists", "playlistItems"]);
    assert.equal(fetchImpl.paramsFor("channels").forHandle, "KWTekken");
    assert.equal(fetchImpl.paramsFor("playlistItems").playlistId, "PL7");
  });

  it("prefers #10 over #9 whatever the playlist order", async () => {
    const sandbox = await sandboxWith();
    const result = await run({
      sandbox,
      fetchImpl: createYouTubeFetch({
        playlistPages: [
          [
            playlist("PL9", "Basement Brawl #9", 12),
            playlist("PL10", "Basement Brawl #10", 9),
            playlist("PL1", "Basement Brawl #1", 30),
          ],
        ],
        itemPages: [[{ items: [playlistItem("x", "Grand Finals")] }]],
      }),
    });

    assert.equal(result.playlistId, "PL10");
    assert.equal((await sandbox.readJson("videos.json")).playlistId, "PL10");
  });

  it("skips an empty newest playlist and uses the next one down", async () => {
    const sandbox = await sandboxWith();
    const result = await run({
      sandbox,
      fetchImpl: createYouTubeFetch({
        playlistPages: [[playlist("PL10", "Basement Brawl #10", 0), playlist("PL9", "Basement Brawl #9", 11)]],
        itemPages: [[{ items: [playlistItem("x", "Round 1")] }]],
      }),
    });

    assert.equal(result.playlistId, "PL9");
    assert.equal(result.exitCode, 0);
  });

  it("uses YOUTUBE_CHANNEL_ID and skips the handle lookup", async () => {
    const sandbox = await sandboxWith();
    const fetchImpl = healthyFetch();
    const result = await run({ sandbox, env: { YOUTUBE_CHANNEL_ID: "UCexplicit" }, fetchImpl });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(fetchImpl.endpoints(), ["playlists", "playlistItems"]);
    assert.equal(fetchImpl.paramsFor("playlists").channelId, "UCexplicit");
  });

  it("lets YOUTUBE_CHANNEL_HANDLE pick another handle", async () => {
    const sandbox = await sandboxWith();
    const fetchImpl = healthyFetch();

    await run({ sandbox, env: { YOUTUBE_CHANNEL_HANDLE: "@SomebodyElse" }, fetchImpl });

    assert.equal(fetchImpl.paramsFor("channels").forHandle, "SomebodyElse");
  });

  it("respects YOUTUBE_PLAYLIST_ID and skips playlist discovery", async () => {
    const sandbox = await sandboxWith();
    const fetchImpl = createYouTubeFetch({
      playlistById: playlist("PLforced", "Basement Brawl #4 (archive)", 2),
      itemPages: [[{ items: [playlistItem("a", "One")] }]],
    });
    const result = await run({ sandbox, env: { YOUTUBE_PLAYLIST_ID: "PLforced" }, fetchImpl });

    assert.equal(result.playlistId, "PLforced");
    assert.equal(result.playlistTitle, "Basement Brawl #4 (archive)");
    assert.equal(result.playlistSource, "env");
    assert.deepEqual(fetchImpl.endpoints(), ["playlists", "playlistItems"], "no channel or playlist listing");
    assert.equal(fetchImpl.paramsFor("playlists").id, "PLforced");
  });

  it("pages through playlist items and keeps playlist order", async () => {
    const sandbox = await sandboxWith();
    const fetchImpl = createYouTubeFetch({
      playlistPages: [[playlist("PL10", "Basement Brawl #10", 3)]],
      itemPages: [
        { items: [playlistItem("a", "One")], nextPageToken: "p2" },
        { items: [playlistItem("b", "Private video"), playlistItem("c", "Three")], nextPageToken: "p3" },
        { items: [playlistItem("a", "Duplicate"), playlistItem("d", "Four")] },
      ],
    });
    const result = await run({ sandbox, fetchImpl, env: { YOUTUBE_MAX_RESULTS: "2" } });

    assert.equal(result.videoCount, 3);
    assert.deepEqual((await sandbox.readJson("videos.json")).videoIds, ["a", "c", "d"]);
    assert.equal(fetchImpl.calls.filter((call) => call.endpoint === "playlistItems").length, 3);
  });

  it("reports no change when only generatedAt moved", async () => {
    const current = { generatedAt: "2020-01-01T00:00:00.000Z", playlistId: "PL10", playlistTitle: "Basement Brawl #10", videoIds: ["a", "b"] };
    const sandbox = await sandboxWith(current);
    const before = await sandbox.read("videos.json");
    const result = await run({ sandbox, fetchImpl: healthyFetch({ items: [playlistItem("a", "Pool 1"), playlistItem("b", "Pool 2")] }) });
    const after = await sandbox.read("videos.json");

    assert.equal(result.status, "updated");
    assert.equal(result.changed, false);
    assert.equal(after, before, "generatedAt-only refreshes are not written");
  });

  it("does not write in dry-run mode", async () => {
    const sandbox = await sandboxWith();
    const before = await sandbox.read("videos.json");
    const result = await run({ sandbox, fetchImpl: healthyFetch(), options: { dryRun: true } });

    assert.equal(result.status, "updated");
    assert.equal(result.written, false);
    assert.equal(await sandbox.read("videos.json"), before);
    assert.match(result.capture.text(), /Would write/);
  });
});

describe("update-videos: without a key", () => {
  it("keeps the checked-in file and exits 0", async () => {
    const seed = {
      generatedAt: "2026-11-14T00:00:00.000Z",
      playlistId: "PLSUqpdkh-18I",
      playlistTitle: "Basement Brawl #8",
      videoIds: ["oxq3G09T900"],
    };
    const sandbox = await sandboxWith(seed);
    const before = await sandbox.read("videos.json");
    const fetchImpl = createYouTubeFetch({});
    const result = await run({ sandbox, env: { YOUTUBE_API_KEY: "" }, fetchImpl });

    assert.equal(result.status, "skipped");
    assert.equal(result.exitCode, 0);
    assert.equal(result.changed, false);
    assert.equal(result.videoCount, 1);
    assert.equal(fetchImpl.calls.length, 0, "no API call without a key");
    assert.match(result.capture.text(), /YOUTUBE_API_KEY is not set/);
    assert.equal(await sandbox.read("videos.json"), before);
  });

  it("exits 0 as a real process", async () => {
    const sandbox = await sandboxWith({ playlistId: "PL8", playlistTitle: "Basement Brawl #8", videoIds: ["a"] });
    const child = spawnSync(process.execPath, [CLI, "--out", sandbox.videosFile], {
      encoding: "utf8",
      env: { YOUTUBE_API_KEY: "" },
    });

    assert.equal(child.status, 0, child.stderr);
    assert.match(`${child.stderr}${child.stdout}`, /YOUTUBE_API_KEY is not set/);
    assert.deepEqual((await sandbox.readJson("videos.json")).videoIds, ["a"]);
  });
});

describe("update-videos: API failures keep the good file", () => {
  const cases = [
    {
      name: "HTTP 403 on the playlists call",
      fetchImpl: () => createYouTubeFetch({ http: { playlists: 403 } }),
      pattern: /HTTP 403/,
    },
    {
      name: "HTTP 401 on the channel lookup",
      fetchImpl: () => createYouTubeFetch({ http: { channels: 401 } }),
      pattern: /HTTP 401/,
    },
    {
      name: "a network failure",
      fetchImpl: () =>
        createYouTubeFetch({
          playlistPages: [[playlist("PL10", "Basement Brawl #10", 2)]],
          networkError: { playlistItems: "socket hang up" },
        }),
      pattern: /socket hang up/,
    },
    {
      name: "an unresolvable handle",
      fetchImpl: () => createYouTubeFetch({ channels: [] }),
      pattern: /no channel for handle/,
    },
    {
      name: "no playlists at all",
      fetchImpl: () => createYouTubeFetch({ playlistPages: [[]] }),
      pattern: /no playlists/,
    },
    {
      name: "no event playlist among the playlists",
      fetchImpl: () => createYouTubeFetch({ playlistPages: [[playlist("PLv", "Stream VODs", 100)]] }),
      pattern: /No "Basement Brawl #N" playlist/,
    },
    {
      name: "an empty playlist listing",
      fetchImpl: () =>
        createYouTubeFetch({
          playlistPages: [[playlist("PL10", "Basement Brawl #10", 4)]],
          itemPages: [[]],
        }),
      pattern: /returned no items/,
    },
    {
      name: "a playlist where every video is private or deleted",
      fetchImpl: () =>
        createYouTubeFetch({
          playlistPages: [[playlist("PL10", "Basement Brawl #10", 3)]],
          itemPages: [
            [
              {
                items: [
                  playlistItem("a", "Private video"),
                  playlistItem("b", "Deleted video"),
                  playlistItem("c", "Hidden", "private"),
                  playlistItem(null, "No resource"),
                ],
              },
            ],
          ],
        }),
      pattern: /no public, non-deleted videos/,
    },
    {
      name: "an unknown override playlist id",
      fetchImpl: () => createYouTubeFetch({ playlistById: null }),
      pattern: /no playlist with id "PLdoesnotexist"/,
      env: { YOUTUBE_PLAYLIST_ID: "PLdoesnotexist" },
    },
  ];

  for (const testCase of cases) {
    it(`leaves videos.json untouched on ${testCase.name}`, async () => {
      const seed = {
        generatedAt: "2026-10-01T00:00:00.000Z",
        playlistId: "PL8",
        playlistTitle: "Basement Brawl #8",
        videoIds: videoIds(3),
      };
      const sandbox = await sandboxWith(seed);
      const before = await sandbox.read("videos.json");
      const result = await run({ sandbox, env: testCase.env ?? {}, fetchImpl: testCase.fetchImpl() });

      assert.equal(result.status, "failed");
      assert.equal(result.exitCode, 1);
      assert.match(result.message, testCase.pattern);
      assert.match(result.capture.text(), /Keeping the existing file untouched/);
      assert.equal(await sandbox.read("videos.json"), before);
      assert.deepEqual(await sandbox.entries(), ["events.json", "videos.json"], "no temp file left behind");
      assert.doesNotMatch(result.capture.text(), /youtube-secret-key-value/);
      assert.doesNotMatch(result.message, /youtube-secret-key-value/);
    });
  }

  it("emits only the four allow-listed keys and no secret values", async () => {
    const sandbox = await sandboxWith();
    const result = await run({ sandbox, fetchImpl: healthyFetch() });
    const raw = await sandbox.read("videos.json");

    assert.equal(result.exitCode, 0);
    assert.deepEqual(Object.keys(JSON.parse(raw)), VIDEOS_KEYS);
    assert.doesNotMatch(raw, /youtube-secret-key-value|YOUTUBE_API_KEY|STARTGG_TOKEN/);
  });
});

describe("update-videos: CLI wrapper", () => {
  it("runs end to end against a temp copy of public/", async () => {
    const { main } = await import("../scripts/update-videos.mjs");
    const sandbox = await sandboxWith();
    const result = await main({
      argv: ["--out", sandbox.videosFile],
      env: { YOUTUBE_API_KEY: KEY },
      fetchImpl: healthyFetch({ items: [playlistItem("zz", "Grand Finals")] }),
      now: fixedNow(NOW),
      ...capture().loggers,
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(await sandbox.readJson("videos.json"), {
      generatedAt: NOW,
      playlistId: "PL10",
      playlistTitle: "Basement Brawl #10",
      videoIds: ["zz"],
    });
  });

  it("supports --help and rejects a bad flag", async () => {
    const { main } = await import("../scripts/update-videos.mjs");
    const help = await main({ argv: ["--help"], ...capture().loggers });

    assert.equal(help.exitCode, 0);
    assert.equal((await main({ argv: ["--bogus"], ...capture().loggers })).exitCode, 2);
  });
});
