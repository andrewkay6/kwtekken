import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  YouTubeError,
  buildYouTubeUrl,
  cleanHandle,
  collectVideoIds,
  extractEventNumber,
  fetchChannelIdByHandle,
  fetchChannelPlaylists,
  fetchPlaylistById,
  fetchPlaylistItems,
  isUsablePlaylistItem,
  selectEventPlaylist,
} from "../scripts/lib/youtube.mjs";
import { createYouTubeFetch } from "./helpers/api.mjs";
import { playlist, playlistItem } from "./fixtures/shapes.mjs";

const KEY = "yt-key-SECRET";

function expectError(promise, pattern) {
  return promise.then(
    () => assert.fail(`expected a failure matching ${pattern}`),
    (error) => {
      assert.match(error.message, pattern);

      return error;
    },
  );
}

describe("buildYouTubeUrl", () => {
  it("sends the documented parameters and puts the key last", () => {
    const url = new URL(buildYouTubeUrl("playlists", { channelId: "UC1", part: "snippet,contentDetails" }, KEY));

    assert.equal(url.origin + url.pathname, "https://www.googleapis.com/youtube/v3/playlists");
    assert.equal(url.searchParams.get("channelId"), "UC1");
    assert.equal(url.searchParams.get("part"), "snippet,contentDetails");
    assert.equal([...url.searchParams.keys()].at(-1), "key");
  });

  it("drops empty parameters and skips the page token on the first page", () => {
    const url = new URL(buildYouTubeUrl("playlistItems", { playlistId: "P", pageToken: null }, KEY));

    assert.equal(url.searchParams.has("pageToken"), false);
  });

  it("strips an @ from a handle", () => {
    assert.equal(cleanHandle("@KWTekken"), "KWTekken");
    assert.equal(cleanHandle("  KWTekken  "), "KWTekken");
  });
});

describe("extractEventNumber", () => {
  it("reads the event number from event playlist titles", () => {
    assert.equal(extractEventNumber("Basement Brawl #10"), 10);
    assert.equal(extractEventNumber("Basement Brawl #7 (CAFÉ EDITION)"), 7);
    assert.equal(extractEventNumber("Basement Brawl # 3"), 3);
    assert.equal(extractEventNumber("KW Tekken #1 Grand Finals"), 1);
  });

  it("returns null when there is no event number", () => {
    for (const title of ["Stream VODs", "Clips", "Tekken 8 Highlights", "", null, undefined, 42]) {
      assert.equal(extractEventNumber(title), null, String(title));
    }
  });
});

describe("selectEventPlaylist", () => {
  it("picks the highest event number regardless of input order", () => {
    const playlists = [
      playlist("PL7", "Basement Brawl #7 (CAFÉ EDITION)", 12),
      playlist("PL10", "Basement Brawl #10", 9),
      playlist("PL9", "Basement Brawl #9", 14),
    ];

    for (const order of [playlists, [...playlists].reverse(), [playlists[1], playlists[2], playlists[0]]]) {
      const selected = selectEventPlaylist(order);

      assert.equal(selected.playlistId, "PL10");
      assert.equal(selected.title, "Basement Brawl #10");
      assert.equal(selected.eventNumber, 10);
    }
  });

  it("compares numerically so #10 beats #9", () => {
    const selected = selectEventPlaylist([playlist("PL9", "Basement Brawl #9", 20), playlist("PL10", "Basement Brawl #10", 1)]);

    assert.equal(selected.playlistId, "PL10");
  });

  it("ignores playlists that are not numbered events", () => {
    const selected = selectEventPlaylist([
      playlist("PLvod", "Stream VODs", 200),
      playlist("PLclip", "Clips", 40),
      playlist("PL8", "Basement Brawl #8", 9),
    ]);

    assert.equal(selected.playlistId, "PL8");
  });

  it("skips event playlists with no items", () => {
    const selected = selectEventPlaylist([
      playlist("PL10", "Basement Brawl #10", 0),
      playlist("PL9", "Basement Brawl #9", 11),
    ]);

    assert.equal(selected.playlistId, "PL9");
  });

  it("treats a missing itemCount as empty", () => {
    const noCount = { id: "PLx", snippet: { title: "Basement Brawl #12" } };

    assert.equal(selectEventPlaylist([noCount, playlist("PL9", "Basement Brawl #9", 3)]).playlistId, "PL9");
    assert.equal(selectEventPlaylist([noCount]), null);
  });

  it("breaks ties by publish date then id, deterministically", () => {
    const older = playlist("PLa", "Basement Brawl #9", 5, "2026-01-01T00:00:00Z");
    const newer = playlist("PLb", "Basement Brawl #9 (afterparty)", 5, "2026-06-01T00:00:00Z");

    assert.equal(selectEventPlaylist([older, newer]).playlistId, "PLb");
    assert.equal(selectEventPlaylist([newer, older]).playlistId, "PLb");

    const sameDayA = playlist("PLz", "Basement Brawl #9", 5, "2026-06-01T00:00:00Z");
    const sameDayB = playlist("PLa", "Basement Brawl #9", 5, "2026-06-01T00:00:00Z");

    assert.equal(selectEventPlaylist([sameDayA, sameDayB]).playlistId, "PLa");
    assert.equal(selectEventPlaylist([sameDayB, sameDayA]).playlistId, "PLa");
  });

  it("deduplicates repeated playlist ids", () => {
    const once = playlist("PL10", "Basement Brawl #10", 9);

    assert.equal(selectEventPlaylist([once, once, once]).playlistId, "PL10");
  });

  it("returns null when nothing qualifies", () => {
    assert.equal(selectEventPlaylist([]), null);
    assert.equal(selectEventPlaylist(null), null);
    assert.equal(selectEventPlaylist([playlist("PLv", "VODs", 5), playlist("PL0", "Basement Brawl #3", 0)]), null);
  });
});

describe("playlist items", () => {
  it("keeps public videos only", () => {
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "Basement Brawl #10 Grand Finals")), true);
    assert.equal(isUsablePlaylistItem({ contentDetails: { videoId: "abc" }, snippet: { title: "Stuff" } }), true);
  });

  it("drops private, deleted and placeholder entries", () => {
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "Private video")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "Deleted video")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "  DELETED VIDEO  ")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "Title", "private")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "Title", "unlisted")), false);
    assert.equal(isUsablePlaylistItem(playlistItem(null, "Title")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("   ", "Title")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("abc", "")), false);
    assert.equal(isUsablePlaylistItem(playlistItem("abc", null)), false);
    assert.equal(isUsablePlaylistItem(null), false);
  });

  it("reads the video id from either shape and de-duplicates in order", () => {
    const ids = collectVideoIds([
      playlistItem("a", "First"),
      { snippet: { title: "Second", resourceId: { videoId: "b" } } },
      playlistItem("a", "Dupe"),
      playlistItem("c", "Private video"),
      playlistItem("d", "Fourth", "private"),
      playlistItem("e", "Fifth"),
    ]);

    assert.deepEqual(ids, ["a", "b", "e"]);
    assert.deepEqual(collectVideoIds([]), []);
    assert.deepEqual(collectVideoIds(null), []);
  });
});

describe("YouTube requests", () => {
  it("resolves the channel from the handle", async () => {
    const fetchImpl = createYouTubeFetch({ channels: [{ id: "UCresolved" }] });

    assert.equal(await fetchChannelIdByHandle({ fetchImpl, handle: "@KWTekken", key: KEY }), "UCresolved");
    assert.equal(fetchImpl.paramsFor("channels").forHandle, "KWTekken");
    assert.equal(fetchImpl.paramsFor("channels").part, "id");
    assert.equal(fetchImpl.calls[0].key, KEY);
  });

  it("fails when the handle resolves to nothing", async () => {
    await expectError(
      fetchChannelIdByHandle({ fetchImpl: createYouTubeFetch({ channels: [] }), handle: "nope", key: KEY }),
      /no channel for handle "@nope"/,
    );
  });

  it("lists channel playlists across pages", async () => {
    const fetchImpl = createYouTubeFetch({
      playlistPages: [
        { items: [playlist("PL1", "Basement Brawl #1", 3)], nextPageToken: "p2" },
        { items: [playlist("PL11", "Basement Brawl #11", 8)] },
      ],
    });
    const items = await fetchChannelPlaylists({ fetchImpl, channelId: "UC1", key: KEY, maxResults: 1 });

    assert.deepEqual(items.map((item) => item.id), ["PL1", "PL11"]);
    assert.equal(fetchImpl.calls[1].params.pageToken, "p2");
  });

  it("fails when the channel has no playlists", async () => {
    const error = await expectError(
      fetchChannelPlaylists({ fetchImpl: createYouTubeFetch({ playlistPages: [[]] }), channelId: "UC1", key: KEY }),
      /no playlists/,
    );

    assert.ok(error instanceof YouTubeError);
  });

  it("looks up an override playlist by id", async () => {
    const fetchImpl = createYouTubeFetch({ playlistById: playlist("PLover", "Basement Brawl #4", 2) });
    const found = await fetchPlaylistById({ fetchImpl, playlistId: "PLover", key: KEY });

    assert.deepEqual(
      { id: found.playlistId, title: found.title, count: found.itemCount, number: found.eventNumber },
      { id: "PLover", title: "Basement Brawl #4", count: 2, number: 4 },
    );
    assert.equal(fetchImpl.paramsFor("playlists").id, "PLover");
    assert.equal(fetchImpl.paramsFor("playlists").part, "snippet,contentDetails");
  });

  it("fails when the override playlist id is unknown", async () => {
    await expectError(
      fetchPlaylistById({ fetchImpl: createYouTubeFetch({ playlistById: null }), playlistId: "PLghost", key: KEY }),
      /no playlist with id "PLghost"/,
    );
  });

  it("pages through playlist items", async () => {
    const fetchImpl = createYouTubeFetch({
      itemPages: [
        { items: [playlistItem("a", "One")], nextPageToken: "p2" },
        { items: [playlistItem("b", "Two"), playlistItem("c", "Private video")] },
      ],
    });
    const items = await fetchPlaylistItems({ fetchImpl, playlistId: "PL10", key: KEY, maxResults: 2 });

    assert.deepEqual(collectVideoIds(items), ["a", "b"]);
    assert.equal(fetchImpl.calls[1].params.pageToken, "p2");
    assert.equal(fetchImpl.paramsFor("playlistItems").part, "snippet,status,contentDetails");
  });

  it("fails on an empty playlist, an HTTP error and a network error", async () => {
    await expectError(
      fetchPlaylistItems({ fetchImpl: createYouTubeFetch({ itemPages: [[]] }), playlistId: "PL10", key: KEY }),
      /returned no items/,
    );

    const httpError = await expectError(
      fetchChannelPlaylists({ fetchImpl: createYouTubeFetch({ http: { playlists: 403 } }), channelId: "UC1", key: KEY }),
      /HTTP 403/,
    );

    assert.match(httpError.message, /check YOUTUBE_API_KEY/);

    await expectError(
      fetchChannelPlaylists({
        fetchImpl: createYouTubeFetch({ networkError: { playlists: "socket reset" } }),
        channelId: "UC1",
        key: KEY,
      }),
      /request failed: socket reset/,
    );
  });

  it("never repeats the API key from an error body", async () => {
    const error = await expectError(
      fetchChannelPlaylists({
        fetchImpl: createYouTubeFetch({
          http: { playlists: 400 },
          errorMessages: { playlists: "API key KEY not valid" },
        }),
        channelId: "UC1",
        key: KEY,
      }),
      /HTTP 400/,
    );

    assert.doesNotMatch(error.message, /yt-key-SECRET/);
    assert.match(error.message, /\[redacted\]/);
  });

  it("surfaces an error carried by a 200 response", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: { message: "playlist not found for KEY" } }),
    });

    const error = await expectError(
      fetchChannelPlaylists({ fetchImpl, channelId: "UC1", key: KEY }),
      /playlist not found/,
    );

    assert.doesNotMatch(error.message, /yt-key-SECRET/);
  });
});
