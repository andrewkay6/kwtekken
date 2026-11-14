import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVENT_FEED_KEYS,
  SCENE_EVENT_KEYS,
  TOURNAMENT_KEYS,
  VIDEOS_KEYS,
  projectEventFeed,
  projectVideos,
  validateEventFeed,
  validateVideos,
} from "../scripts/lib/schema.mjs";
import { previousFeed, tournamentDetails } from "./fixtures/shapes.mjs";
import { mapTournament } from "../scripts/lib/startgg.mjs";
import { collectVideoIds, mapPlaylist } from "../scripts/lib/youtube.mjs";

describe("events feed allow-list", () => {
  it("emits exactly the allow-listed keys, in order", () => {
    const { value, dropped } = projectEventFeed(previousFeed());

    assert.deepEqual(Object.keys(value), EVENT_FEED_KEYS);
    assert.deepEqual(Object.keys(value.tournament), TOURNAMENT_KEYS);
    assert.deepEqual(dropped, []);
  });

  it("drops credential-shaped keys instead of writing them", () => {
    const { value, dropped } = projectEventFeed({
      sourceUrl: "https://www.start.gg/tournament/a/details",
      generatedAt: null,
      authorization: "Bearer abc",
      STARTGG_TOKEN: "leaked",
      tournament: { name: "A", slug: "tournament/a", STARTGG_TOKEN: "leaked", cookie: "x" },
      events: [{ id: 1, name: "Open", token: "leaked" }],
    });

    assert.deepEqual(Object.keys(value), EVENT_FEED_KEYS);
    assert.deepEqual(Object.keys(value.tournament), TOURNAMENT_KEYS);
    assert.deepEqual(Object.keys(value.events[0]), ["id", "name"]);
    assert.equal("token" in value.events[0], false);
    assert.deepEqual(dropped, ["STARTGG_TOKEN", "authorization", "tournament.STARTGG_TOKEN", "tournament.cookie"]);
    assert.doesNotMatch(JSON.stringify(value), /leaked|Bearer abc|"x"/);
  });

  it("fills in stable defaults for missing display fields", () => {
    const { value } = projectEventFeed({ tournament: { name: "A" } });

    assert.deepEqual(value, {
      sourceUrl: "",
      generatedAt: null,
      tournament: {
        name: "A",
        slug: "",
        startAt: null,
        endAt: null,
        venueAddress: "",
        city: "",
        region: "",
        countryCode: "",
        embedTitle: null,
        embedDescription: null,
        embedImageUrl: null,
      },
      events: [],
    });
  });

  it("validates the mapped start.gg tournament", () => {
    const mapped = mapTournament(tournamentDetails({ slug: "tournament/a" }));
    const feed = projectEventFeed({
      sourceUrl: "https://www.start.gg/tournament/a/details",
      generatedAt: "2026-11-14T12:00:00.000Z",
      tournament: mapped,
      events: mapped.events,
    }).value;

    assert.deepEqual(validateEventFeed(feed), []);
  });

  it("reports structural problems", () => {
    assert.deepEqual(validateEventFeed(null), ["events.json is not an object"]);
    assert.match(validateEventFeed({}).join("; "), /sourceUrl must be a string/);
    assert.deepEqual(validateEventFeed(previousFeed()), []);
    assert.match(
      validateEventFeed({ ...previousFeed(), bogus: 1, tournament: { name: 1 } }).join("\n"),
      /unexpected key "events\.bogus"/,
    );
    assert.match(validateEventFeed({ sourceUrl: "x", generatedAt: null, tournament: { name: "" }, events: [] }).join("\n"), /name must not be empty/);
    assert.match(
      validateEventFeed(
        { sourceUrl: "x", generatedAt: null, tournament: { name: "A" }, events: [{ name: 3 }] },
      ).join("\n"),
      /events\[0\]\.id is required/,
    );
  });
});

describe("videos allow-list", () => {
  it("emits exactly the four keys", () => {
    const { value, dropped } = projectVideos({
      generatedAt: "2026-11-14T12:00:00.000Z",
      playlistId: "PL10",
      playlistTitle: "Basement Brawl #10",
      videoIds: ["a"],
      YOUTUBE_API_KEY: "leaked",
      channelSecret: "leaked",
    });

    assert.deepEqual(Object.keys(value), VIDEOS_KEYS);
    assert.deepEqual(dropped, ["YOUTUBE_API_KEY", "channelSecret"]);
    assert.doesNotMatch(JSON.stringify(value), /leaked/);
  });

  it("always produces an array of ids", () => {
    assert.deepEqual(projectVideos({ playlistId: "PL" }).value.videoIds, []);
    assert.deepEqual(projectVideos({ videoIds: null }).value.videoIds, []);
  });

  it("validates the videos payload", () => {
    assert.deepEqual(
      validateVideos({ generatedAt: "x", playlistId: "PL10", playlistTitle: "Basement Brawl #10", videoIds: ["a"] }),
      [],
    );
    assert.match(validateVideos(null).join("; "), /not an object/);
    assert.match(validateVideos({}).join("\n"), /playlistId must not be empty/);
    assert.match(validateVideos({ playlistId: "PL", videoIds: [] }).join("\n"), /videoIds must not be empty/);
    assert.match(validateVideos({ playlistId: "PL", videoIds: [""] }).join("\n"), /videoIds\[0\] must not be empty/);
    assert.match(validateVideos({ playlistId: "PL", videoIds: ["a"], bogus: 1 }).join("\n"), /unexpected key "videos\.bogus"/);
  });

  it("survives a real playlist listing end to end", () => {
    const selected = mapPlaylist({ id: "PL10", snippet: { title: "Basement Brawl #10" }, contentDetails: { itemCount: 2 } });
    const ids = collectVideoIds([
      { contentDetails: { videoId: "a" }, snippet: { title: "Pools" }, status: { privacyStatus: "public" } },
      { contentDetails: { videoId: "b" }, snippet: { title: "Private video" }, status: { privacyStatus: "private" } },
    ]);
    const { value } = projectVideos({
      generatedAt: "2026-11-14T12:00:00.000Z",
      playlistId: selected.playlistId,
      playlistTitle: selected.title,
      videoIds: ids,
    });

    assert.deepEqual(validateVideos(value), []);
    assert.deepEqual(value.videoIds, ["a"]);
  });
});
