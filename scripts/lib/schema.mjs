import { projectKeys } from "./io.mjs";

export const EVENT_FEED_KEYS = ["sourceUrl", "generatedAt", "tournament", "events"];

export const TOURNAMENT_KEYS = [
  "name",
  "slug",
  "startAt",
  "endAt",
  "venueAddress",
  "city",
  "region",
  "countryCode",
  "embedTitle",
  "embedDescription",
  "embedImageUrl",
];

export const SCENE_EVENT_KEYS = ["id", "name", "slug", "startAt", "numEntrants", "videogame"];

export const VIDEOS_KEYS = ["generatedAt", "playlistId", "playlistTitle", "videoIds"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reduces an events feed to the display-only shape the site actually needs. */
export function projectEventFeed(feed) {
  const root = projectKeys(feed, EVENT_FEED_KEYS);
  const sourceProject = projectKeys(feed?.tournament, TOURNAMENT_KEYS);
  const source = sourceProject.value;
  const events = Array.isArray(feed?.events)
    ? feed.events.map((event) => projectKeys(event, SCENE_EVENT_KEYS).value)
    : [];
  const tournament = {
    name: typeof source.name === "string" ? source.name : "",
    slug: typeof source.slug === "string" ? source.slug : "",
    startAt: typeof source.startAt === "number" ? source.startAt : null,
    endAt: typeof source.endAt === "number" ? source.endAt : null,
    venueAddress: typeof source.venueAddress === "string" ? source.venueAddress : "",
    city: typeof source.city === "string" ? source.city : "",
    region: typeof source.region === "string" ? source.region : "",
    countryCode: typeof source.countryCode === "string" ? source.countryCode : "",
    embedTitle: typeof source.embedTitle === "string" ? source.embedTitle : null,
    embedDescription: typeof source.embedDescription === "string" ? source.embedDescription : null,
    embedImageUrl: typeof source.embedImageUrl === "string" ? source.embedImageUrl : null,
  };

  return {
    value: {
      sourceUrl: typeof root.value.sourceUrl === "string" ? root.value.sourceUrl : "",
      generatedAt: typeof root.value.generatedAt === "string" ? root.value.generatedAt : null,
      tournament,
      events,
    },
    dropped: [...root.dropped, ...sourceProject.dropped.map((key) => `tournament.${key}`)],
  };
}

export function projectVideos(videos) {
  const root = projectKeys(videos, VIDEOS_KEYS);

  return {
    value: {
      generatedAt: typeof root.value.generatedAt === "string" ? root.value.generatedAt : null,
      playlistId: typeof root.value.playlistId === "string" ? root.value.playlistId : "",
      playlistTitle: typeof root.value.playlistTitle === "string" ? root.value.playlistTitle : "",
      videoIds: Array.isArray(root.value.videoIds) ? [...root.value.videoIds] : [],
    },
    dropped: root.dropped,
  };
}

function typeProblem(problems, condition, message) {
  if (!condition) problems.push(message);
}

/** Structural check used by the live verification script. Returns problem strings. */
export function validateEventFeed(feed) {
  const problems = [];

  if (!isPlainObject(feed)) return ["events.json is not an object"];

  for (const key of Object.keys(feed)) {
    if (!EVENT_FEED_KEYS.includes(key)) problems.push(`unexpected key "events.${key}"`);
  }

  typeProblem(problems, typeof feed.sourceUrl === "string", "events.sourceUrl must be a string");
  typeProblem(
    problems,
    typeof feed.generatedAt === "string" || feed.generatedAt === null,
    "events.generatedAt must be a string or null",
  );
  typeProblem(problems, isPlainObject(feed.tournament), "events.tournament must be an object");
  typeProblem(problems, Array.isArray(feed.events), "events.events must be an array");

  if (isPlainObject(feed.tournament)) {
    for (const key of Object.keys(feed.tournament)) {
      if (!TOURNAMENT_KEYS.includes(key)) {
        problems.push(`unexpected key "events.tournament.${key}"`);
      }
    }

    typeProblem(problems, typeof feed.tournament.name === "string", "tournament.name must be a string");
    typeProblem(problems, feed.tournament.name !== "", "tournament.name must not be empty");
    typeProblem(problems, typeof feed.tournament.slug === "string", "tournament.slug must be a string");
    typeProblem(
      problems,
      typeof feed.tournament.startAt === "number" || feed.tournament.startAt === null,
      "tournament.startAt must be a number or null",
    );
  }

  if (Array.isArray(feed.events)) {
    for (const [index, event] of feed.events.entries()) {
      if (!isPlainObject(event)) {
        problems.push(`events[${index}] must be an object`);
        continue;
      }

      for (const key of Object.keys(event)) {
        if (!SCENE_EVENT_KEYS.includes(key)) problems.push(`unexpected key "events[${index}].${key}"`);
      }

      typeProblem(problems, event.id !== undefined, `events[${index}].id is required`);
      typeProblem(problems, typeof event.name === "string", `events[${index}].name must be a string`);
    }
  }

  return problems;
}

export function validateVideos(videos) {
  const problems = [];

  if (!isPlainObject(videos)) return ["videos.json is not an object"];

  for (const key of Object.keys(videos)) {
    if (!VIDEOS_KEYS.includes(key)) problems.push(`unexpected key "videos.${key}"`);
  }

  typeProblem(
    problems,
    typeof videos.generatedAt === "string" || videos.generatedAt === null,
    "videos.generatedAt must be a string or null",
  );
  typeProblem(problems, typeof videos.playlistId === "string", "videos.playlistId must be a string");
  typeProblem(problems, Boolean(videos.playlistId), "videos.playlistId must not be empty");
  typeProblem(problems, typeof videos.playlistTitle === "string", "videos.playlistTitle must be a string");
  typeProblem(problems, Array.isArray(videos.videoIds), "videos.videoIds must be an array");

  if (Array.isArray(videos.videoIds)) {
    if (!videos.videoIds.length) problems.push("videos.videoIds must not be empty");

    videos.videoIds.forEach((videoId, index) => {
      typeProblem(problems, typeof videoId === "string", `videos.videoIds[${index}] must be a string`);
      typeProblem(problems, Boolean(videoId), `videos.videoIds[${index}] must not be empty`);
    });
  }

  return problems;
}
