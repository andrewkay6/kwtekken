import { toUnixSeconds } from "./clock.mjs";
import { redactValues } from "./secrets.mjs";

export const STARTGG_API_URL = "https://api.start.gg/gql/alpha";
export const DEFAULT_GRACE_HOURS = 12;
export const DEFAULT_PER_PAGE = 25;
export const DEFAULT_MAX_PAGES = 5;
export const STARTGG_BASE_URL = "https://www.start.gg";

export class StartggError extends Error {
  constructor(message, { status = null, kind = "api" } = {}) {
    super(message);
    this.name = "StartggError";
    this.status = status;
    this.kind = kind;
  }
}

const CURRENT_USER_QUERY = /* GraphQL */ `
  query CurrentUser {
    currentUser {
      id
    }
  }
`;

const OWNER_TOURNAMENTS_QUERY = /* GraphQL */ `
  query OwnerTournaments($ownerId: ID!, $perPage: Int!, $page: Int!) {
    tournaments(
      query: {
        filter: { ownerId: $ownerId }
        sortBy: "startAt desc"
        perPage: $perPage
        page: $page
      }
    ) {
      nodes {
        id
        name
        slug
        startAt
        endAt
        venueAddress
        city
        addrState
        countryCode
      }
      pageInfo {
        total
        page
        totalPages
      }
    }
  }
`;

const TOURNAMENT_DETAILS_QUERY = /* GraphQL */ `
  query TournamentEvents($slug: String!) {
    tournament(slug: $slug) {
      id
      name
      slug
      startAt
      endAt
      venueAddress
      city
      addrState
      countryCode
      events {
        id
        name
        slug
        startAt
        numEntrants
        videogame {
          name
        }
      }
    }
  }
`;

/**
 * Accepts a start.gg URL or slug in any of the shapes an owner is likely to
 * paste and returns the `tournament/<slug>` form the API wants.
 */
export function extractTournamentSlug(input) {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const hostMatch = trimmed.match(/start\.gg\/([^?#]*)/i);
  const path = (hostMatch ? hostMatch[1] : trimmed).replace(/^\/+|\/+$/g, "");
  if (!path) return null;

  const tournamentMatch = path.match(/tournament\/[^/]+/i);
  if (tournamentMatch) return tournamentMatch[0];

  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path)) return `tournament/${path}`;

  return null;
}

export function startggTournamentUrl(slug) {
  const normalized = extractTournamentSlug(slug);

  return normalized ? `${STARTGG_BASE_URL}/${normalized}/details` : null;
}

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function compareStartAsc(a, b) {
  const aStart = Number(a.startAt);
  const bStart = Number(b.startAt);

  if (aStart !== bStart) return aStart - bStart;

  const aId = numOrNull(a.id);
  const bId = numOrNull(b.id);

  if (aId !== null && bId !== null && aId !== bId) return aId - bId;

  return String(a.slug ?? "").localeCompare(String(b.slug ?? ""));
}

function compareStartDesc(a, b) {
  const aStart = Number(a.startAt);
  const bStart = Number(b.startAt);

  if (aStart !== bStart) return bStart - aStart;

  return compareStartAsc(a, b);
}

/**
 * Picks the tournament to feature: the soonest one that has not (recently)
 * started, where "recently" is the grace window, falling back to the most
 * recent past event. Entries without a usable startAt are ignored.
 */
export function selectTournament(tournaments, { now = new Date(), graceHours = DEFAULT_GRACE_HOURS } = {}) {
  const list = Array.isArray(tournaments) ? tournaments : [];
  const nowSeconds = toUnixSeconds(now);
  const graceSeconds = Math.round(Math.max(0, Number(graceHours) || 0) * 3600);
  const cutoff = nowSeconds - graceSeconds;
  const usable = list.filter((entry) => {
    const start = numOrNull(entry?.startAt);

    return start !== null && start !== 0;
  });

  const upcoming = usable
    .filter((entry) => Number(entry.startAt) >= cutoff)
    .sort(compareStartAsc);

  if (upcoming.length) {
    return { tournament: upcoming[0], kind: "upcoming", cutoff, considered: usable.length, total: list.length };
  }

  const past = usable
    .filter((entry) => Number(entry.startAt) < cutoff)
    .sort(compareStartDesc);

  if (past.length) {
    return { tournament: past[0], kind: "recent-past", cutoff, considered: usable.length, total: list.length };
  }

  return { tournament: null, kind: "none", cutoff, considered: 0, total: list.length };
}

async function postGraphQl({ fetchImpl, token, query, variables, label }) {
  if (typeof fetchImpl !== "function") {
    throw new StartggError("No fetch implementation available for start.gg calls.", { kind: "config" });
  }

  const secrets = token ? [token] : [];
  let response;

  try {
    response = await fetchImpl(STARTGG_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new StartggError(
      `start.gg ${label} request failed: ${redactValues(error?.message ?? "network error", secrets)}`,
      { kind: "network" },
    );
  }

  if (!response?.ok) {
    const status = response?.status ?? "unknown";
    const suffix = Number(status) === 401 || Number(status) === 403 ? " (check STARTGG_TOKEN)" : "";

    throw new StartggError(`start.gg ${label} request returned HTTP ${status}${suffix}`, {
      status,
      kind: "http",
    });
  }

  let payload;

  try {
    payload = await response.json();
  } catch (error) {
    throw new StartggError(
      `start.gg ${label} returned invalid JSON: ${redactValues(error?.message ?? "parse error", secrets)}`,
      { kind: "parse" },
    );
  }

  if (Array.isArray(payload?.errors) && payload.errors.length) {
    const messages = payload.errors.map((entry) => entry?.message ?? "unknown error").join("; ");

    throw new StartggError(`start.gg ${label} GraphQL error: ${redactValues(messages, secrets)}`, {
      kind: "graphql",
    });
  }

  return payload?.data ?? null;
}

export async function fetchCurrentUserId({ fetchImpl, token } = {}) {
  const data = await postGraphQl({
    fetchImpl,
    token,
    query: CURRENT_USER_QUERY,
    variables: {},
    label: "currentUser",
  });
  const id = numOrNull(data?.currentUser?.id ?? null);

  if (id === null || !data?.currentUser) {
    throw new StartggError("start.gg currentUser returned no user; check STARTGG_TOKEN.", { kind: "empty" });
  }

  return id;
}

function declaredPageCount(pageInfo, perPage) {
  const declared = numOrNull(pageInfo?.totalPages ?? null);

  if (declared !== null && declared > 0) return declared;

  const total = numOrNull(pageInfo?.total ?? null);

  if (total !== null && total > 0 && perPage > 0) return Math.ceil(total / perPage);

  return null;
}

/** Walks the paginated owner tournament list and returns every tournament found. */
export async function fetchOwnerTournaments({
  fetchImpl,
  token,
  ownerId,
  perPage = DEFAULT_PER_PAGE,
  maxPages = DEFAULT_MAX_PAGES,
} = {}) {
  const collected = [];
  const seen = new Set();
  let pages = 0;

  for (let page = 1; page <= Math.max(1, maxPages); page += 1) {
    const data = await postGraphQl({
      fetchImpl,
      token,
      query: OWNER_TOURNAMENTS_QUERY,
      variables: { ownerId, perPage, page },
      label: `tournaments(page: ${page})`,
    });

    const nodes = data?.tournaments?.nodes;

    if (!Array.isArray(nodes)) {
      throw new StartggError(`start.gg tournaments(page: ${page}) returned no nodes list.`, { kind: "empty" });
    }

    pages = page;

    for (const node of nodes) {
      const key = String(node?.id ?? node?.slug ?? "");

      if (!key || seen.has(key)) continue;
      seen.add(key);
      collected.push(node);
    }

    const declared = declaredPageCount(data?.tournaments?.pageInfo, perPage);

    if (!nodes.length) break;
    if (declared !== null ? page >= declared : nodes.length < perPage) break;
  }

  if (!collected.length) {
    throw new StartggError("start.gg returned no tournaments for this account.", { kind: "empty" });
  }

  return { tournaments: collected, pages };
}

export async function fetchTournamentDetails({ fetchImpl, token, slug } = {}) {
  const data = await postGraphQl({
    fetchImpl,
    token,
    query: TOURNAMENT_DETAILS_QUERY,
    variables: { slug },
    label: `tournament(${slug})`,
  });
  const tournament = data?.tournament;

  if (!tournament) {
    throw new StartggError(`start.gg returned no tournament for slug "${slug}".`, { kind: "empty" });
  }

  return tournament;
}

/** Maps the API tournament onto the flat feed shape consumed by src/App.tsx. */
export function mapTournament(tournament, { fallbackSlug = "" } = {}) {
  const startAt = numOrNull(tournament?.startAt ?? null);
  const events = Array.isArray(tournament?.events)
    ? tournament.events.map((event) => ({
        id: event?.id ?? "",
        name: event?.name ?? "",
        slug: event?.slug ?? "",
        startAt: numOrNull(event?.startAt ?? null) ?? startAt,
        numEntrants: numOrNull(event?.numEntrants ?? null),
        videogame: event?.videogame?.name ?? "",
      }))
    : [];

  return {
    name: tournament?.name ?? "",
    slug: tournament?.slug ?? fallbackSlug,
    startAt,
    endAt: numOrNull(tournament?.endAt ?? null),
    venueAddress: tournament?.venueAddress ?? "",
    city: tournament?.city ?? "",
    region: tournament?.addrState ?? "",
    countryCode: tournament?.countryCode ?? "",
    events,
  };
}

const EMPTY_EMBED = { embedTitle: null, embedDescription: null, embedImageUrl: null };

export function buildTournamentInfo({ mapped, previous = null, preserve = false, embed = EMPTY_EMBED } = {}) {
  const kept = (key, fallback) => {
    const before = previous?.[key];

    if (preserve && before !== null && before !== undefined && before !== "") return before;

    return fallback;
  };

  return {
    name: mapped.name,
    slug: mapped.slug,
    startAt: kept("startAt", mapped.startAt),
    endAt: mapped.endAt,
    venueAddress: kept("venueAddress", mapped.venueAddress),
    city: kept("city", mapped.city || "Kitchener-Waterloo"),
    region: kept("region", mapped.region || "ON"),
    countryCode: mapped.countryCode || "CA",
    embedTitle: embed?.embedTitle ?? null,
    embedDescription: embed?.embedDescription ?? null,
    embedImageUrl: embed?.embedImageUrl ?? null,
  };
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function extractMeta(html, property) {
  const tags = String(html ?? "").match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const nameMatch = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);

    if (!nameMatch || nameMatch[1] !== property) continue;

    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);

    return contentMatch ? decodeHtmlEntities(contentMatch[1]) : null;
  }

  return null;
}

/** Reads the og: meta tags used by the start.gg link preview. */
export async function fetchEmbedMeta({ fetchImpl, url } = {}) {
  if (!url) throw new StartggError("No start.gg URL available for embed metadata.", { kind: "config" });

  let response;

  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new StartggError(`start.gg embed fetch failed: ${error?.message ?? "network error"}`, {
      kind: "network",
    });
  }

  if (!response?.ok) {
    throw new StartggError(`start.gg embed fetch returned HTTP ${response?.status ?? "unknown"}`, {
      kind: "http",
      status: response?.status,
    });
  }

  const html = await response.text();

  return {
    embedTitle: extractMeta(html, "og:title"),
    embedDescription: extractMeta(html, "og:description"),
    embedImageUrl: extractMeta(html, "og:image"),
  };
}
