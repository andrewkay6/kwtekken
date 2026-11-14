import { redactValues } from "./secrets.mjs";

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const DEFAULT_CHANNEL_HANDLE = "KWTekken";
export const DEFAULT_MAX_RESULTS = 50;
export const DEFAULT_MAX_PAGES = 10;
export const UNAVAILABLE_TITLES = ["private video", "deleted video", "unlisted video"];

export class YouTubeError extends Error {
  constructor(message, { status = null, kind = "api" } = {}) {
    super(message);
    this.name = "YouTubeError";
    this.status = status;
    this.kind = kind;
  }
}

export function cleanHandle(handle) {
  return String(handle ?? "").trim().replace(/^@+/, "");
}

/** The API key is appended last so a partially built URL never carries it. */
export function buildYouTubeUrl(endpoint, params = {}, key = "") {
  const url = new URL(`${YOUTUBE_API_BASE}/${String(endpoint).replace(/^\/+/, "")}`);

  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }

  url.searchParams.set("key", key);

  return url.toString();
}

async function youTubeRequest({ fetchImpl, endpoint, params, key, label }) {
  if (typeof fetchImpl !== "function") {
    throw new YouTubeError("No fetch implementation available for YouTube calls.", { kind: "config" });
  }

  const secrets = key ? [key] : [];
  let response;

  try {
    response = await fetchImpl(buildYouTubeUrl(endpoint, params, key), {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new YouTubeError(
      `YouTube ${label} request failed: ${redactValues(error?.message ?? "network error", secrets)}`,
      { kind: "network" },
    );
  }

  if (!response?.ok) {
    const detail = await readErrorDetail(response, secrets);
    const status = response?.status ?? "unknown";
    const suffix = Number(status) === 400 || Number(status) === 403 ? " (check YOUTUBE_API_KEY)" : "";

    throw new YouTubeError(`YouTube ${label} request returned HTTP ${status}${suffix}${detail}`, {
      status,
      kind: "http",
    });
  }

  let payload;

  try {
    payload = await response.json();
  } catch (error) {
    throw new YouTubeError(
      `YouTube ${label} returned invalid JSON: ${redactValues(error?.message ?? "parse error", secrets)}`,
      { kind: "parse" },
    );
  }

  if (payload?.error?.message) {
    throw new YouTubeError(
      `YouTube ${label} error: ${redactValues(String(payload.error.message), secrets)}`,
      { kind: payload.error.status === "INVALID_PARAMETER" ? "api" : "api" },
    );
  }

  return payload ?? {};
}

async function readErrorDetail(response, secrets) {
  if (typeof response?.json !== "function") return "";

  try {
    const body = await response.json();
    const message = body?.error?.message;

    return message ? `: ${redactValues(String(message), secrets)}` : "";
  } catch {
    return "";
  }
}

export async function fetchChannelIdByHandle({ fetchImpl, handle = DEFAULT_CHANNEL_HANDLE, key } = {}) {
  const payload = await youTubeRequest({
    fetchImpl,
    endpoint: "channels",
    params: { forHandle: cleanHandle(handle), part: "id" },
    key,
    label: "channels(forHandle)",
  });
  const channelId = payload?.items?.[0]?.id;

  if (!channelId) {
    throw new YouTubeError(`YouTube found no channel for handle "@${cleanHandle(handle)}".`, {
      kind: "empty",
    });
  }

  return channelId;
}

/** Lists every playlist owned by the channel (paginated). */
export async function fetchChannelPlaylists({
  fetchImpl,
  channelId,
  key,
  maxResults = DEFAULT_MAX_RESULTS,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const items = [];
  let pageToken = null;
  let pages = 0;

  do {
    const payload = await youTubeRequest({
      fetchImpl,
      endpoint: "playlists",
      params: { channelId, part: "snippet,contentDetails", maxResults, pageToken },
      key,
      label: "playlists",
    });

    pages += 1;
    items.push(...(Array.isArray(payload?.items) ? payload.items : []));
    pageToken = payload?.nextPageToken ?? null;
  } while (pageToken && pages < maxPages);

  if (!items.length) {
    throw new YouTubeError(`YouTube returned no playlists for channel ${channelId}.`, { kind: "empty" });
  }

  return items;
}

export async function fetchPlaylistById({ fetchImpl, playlistId, key } = {}) {
  const payload = await youTubeRequest({
    fetchImpl,
    endpoint: "playlists",
    params: { id: playlistId, part: "snippet,contentDetails" },
    key,
    label: "playlists(id)",
  });
  const item = Array.isArray(payload?.items) ? payload.items[0] : null;

  if (!item) {
    throw new YouTubeError(`YouTube found no playlist with id "${playlistId}".`, { kind: "empty" });
  }

  return mapPlaylist(item);
}

export function mapPlaylist(item) {
  const title = item?.snippet?.title;

  return {
    playlistId: item?.id ?? null,
    title: typeof title === "string" ? title : "",
    itemCount: Number(item?.contentDetails?.itemCount ?? 0) || 0,
    publishedAt: item?.snippet?.publishedAt ?? null,
    eventNumber: extractEventNumber(title),
  };
}

/**
 * Event playlists are titled like "Basement Brawl #10" or
 * "Basement Brawl #7 (CAFÉ EDITION)"; everything without a "#N" is not an
 * event playlist. Returns null when there is no number to compare.
 */
export function extractEventNumber(title) {
  if (typeof title !== "string") return null;

  const match = title.match(/#\s*(\d{1,4})(?!\d)/);

  return match ? Number(match[1]) : null;
}

function playlistRank(a, b) {
  if (a.eventNumber !== b.eventNumber) return b.eventNumber - a.eventNumber;

  const byPublished = String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? ""));

  if (byPublished !== 0) return byPublished;

  return String(a.playlistId ?? "").localeCompare(String(b.playlistId ?? ""));
}

/** Highest event number wins; only playlists that still hold items are eligible. */
export function selectEventPlaylist(playlists) {
  const list = Array.isArray(playlists) ? playlists.map(mapPlaylist) : [];
  const unique = new Map();

  for (const playlist of list) {
    if (!playlist.playlistId) continue;
    if (playlist.eventNumber === null) continue;
    if (playlist.itemCount <= 0) continue;
    if (!unique.has(playlist.playlistId)) unique.set(playlist.playlistId, playlist);
  }

  const candidates = [...unique.values()].sort(playlistRank);

  return candidates.length ? candidates[0] : null;
}

export function playlistItemVideoId(item) {
  const candidate = item?.contentDetails?.videoId ?? item?.snippet?.resourceId?.videoId;

  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

/** Drops private/deleted entries and anything that is not a real video. */
export function isUsablePlaylistItem(item) {
  if (!playlistItemVideoId(item)) return false;

  const title = item?.snippet?.title;

  if (typeof title !== "string" || !title.trim()) return false;
  if (UNAVAILABLE_TITLES.includes(title.trim().toLowerCase())) return false;

  const privacy = item?.status?.privacyStatus ?? item?.snippet?.privacyStatus ?? null;

  if (privacy && privacy !== "public") return false;

  return true;
}

export function collectVideoIds(items) {
  const ordered = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!isUsablePlaylistItem(item)) continue;

    const videoId = playlistItemVideoId(item);

    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    ordered.push(videoId);
  }

  return ordered;
}

/** Lists playlist items (paginated) in playlist order. */
export async function fetchPlaylistItems({
  fetchImpl,
  playlistId,
  key,
  maxResults = DEFAULT_MAX_RESULTS,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const items = [];
  let pageToken = null;
  let pages = 0;

  do {
    const payload = await youTubeRequest({
      fetchImpl,
      endpoint: "playlistItems",
      params: { playlistId, part: "snippet,status,contentDetails", maxResults, pageToken },
      key,
      label: "playlistItems",
    });

    pages += 1;
    items.push(...(Array.isArray(payload?.items) ? payload.items : []));
    pageToken = payload?.nextPageToken ?? null;
  } while (pageToken && pages < maxPages);

  if (!items.length) {
    throw new YouTubeError(`YouTube playlist ${playlistId} returned no items.`, { kind: "empty" });
  }

  return items;
}
