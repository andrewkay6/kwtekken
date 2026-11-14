import { STARTGG_API_URL } from "../../scripts/lib/startgg.mjs";
import { EMBED_HTML } from "../fixtures/shapes.mjs";

export function jsonResponse(payload, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => payload,
    text: async () => JSON.stringify(payload ?? ""),
  };
}

export function htmlResponse(html = "", { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    text: async () => html,
    json: async () => {
      throw new Error("body is not JSON");
    },
  };
}

function operationOf(query) {
  return String(query ?? "").match(/query\s+([A-Za-z0-9_]+)/)?.[1] ?? "Unknown";
}

/**
 * start.gg fake: GraphQL POSTs are routed by operation name, the og: meta page by URL.
 * http / graphqlErrors / networkError are keyed by "CurrentUser", "OwnerTournaments",
 * "TournamentEvents" and "embed".
 */
export function createStartggFetch({
  currentUser = { currentUser: { id: 4242, username: "kwtekken" } },
  tournamentPages = [],
  details = null,
  embedHtml = EMBED_HTML,
  http = {},
  graphqlErrors = {},
  networkError = {},
} = {}) {
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    const isApi = url === STARTGG_API_URL;
    const body = isApi ? JSON.parse(init.body ?? "{}") : null;
    const operation = isApi ? operationOf(body?.query) : "embed";
    const variables = isApi ? body?.variables ?? {} : { url };

    calls.push({ url, operation, variables, headers: init.headers ?? {}, method: init.method ?? "GET" });

    if (networkError[operation]) throw new Error(String(networkError[operation]));

    if (!isApi) {
      if (http.embed) {
        return htmlResponse("", { ok: false, status: http.embed, statusText: "Service Unavailable" });
      }

      return htmlResponse(embedHtml);
    }

    if (http[operation]) {
      return jsonResponse(
        { errors: [{ message: "This body must never leak the bearer token" }] },
        { ok: false, status: http[operation], statusText: "Error" },
      );
    }

    if (graphqlErrors[operation]) {
      return jsonResponse({ errors: graphqlErrors[operation], data: null });
    }

    if (operation === "CurrentUser") return jsonResponse({ data: currentUser });

    if (operation === "OwnerTournaments") {
      const index = Number(variables.page ?? 1) - 1;
      const page = tournamentPages[index];
      const nodes = Array.isArray(page) ? page : Array.isArray(page?.nodes) ? page.nodes : [];
      const pageInfo = Array.isArray(page) || !page ? {} : page.pageInfo ?? {};

      return jsonResponse({ data: { tournaments: { nodes, pageInfo } } });
    }

    if (operation === "TournamentEvents") {
      return jsonResponse({ data: { tournament: details } });
    }

    return jsonResponse({ data: {} });
  };

  fetchImpl.calls = calls;
  fetchImpl.operations = () => calls.map((call) => call.operation);
  fetchImpl.header = (name) =>
    calls.map((call) => call.headers?.[name]).find((value) => typeof value === "string") ?? null;

  return fetchImpl;
}

/** A page is either a bare array of items or an { items, nextPageToken } object. */
function normalizePage(page) {
  if (!page) return { items: [] };

  if (Array.isArray(page)) {
    const [only] = page;

    if (page.length === 1 && Array.isArray(only?.items)) return only;

    return { items: page };
  }

  return page;
}

function pageFor(pages, pageToken) {
  if (!pageToken) return normalizePage(pages[0]);

  const index = pages.findIndex(
    (page, position) => position > 0 && normalizePage(pages[position - 1]).nextPageToken === pageToken,
  );

  return index === -1 ? { items: [] } : normalizePage(pages[index]);
}

/**
 * YouTube Data API fake: routed by endpoint with nextPageToken paging.
 * http / networkError are keyed by "channels", "playlists", "playlistItems".
 */
export function createYouTubeFetch({
  channels = [{ id: "UC_kwtekken_01" }],
  playlistPages = [],
  playlistById = null,
  itemPages = [],
  http = {},
  networkError = {},
  errorMessages = {},
} = {}) {
  const calls = [];

  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.split("/").pop();
    const params = Object.fromEntries(parsed.searchParams.entries());
    const key = parsed.searchParams.get("key");

    calls.push({ url: parsed.toString(), endpoint, params, key });

    if (networkError[endpoint]) {
      const message = typeof networkError[endpoint] === "function" ? networkError[endpoint](key) : networkError[endpoint];

      throw new Error(String(message));
    }

    const echo = errorMessages[endpoint];

    if (http[endpoint]) {
      return jsonResponse(
        { error: { code: http[endpoint], message: echo ? String(echo).replace("KEY", key) : "request failed" } },
        { ok: false, status: http[endpoint], statusText: "Error" },
      );
    }

    if (endpoint === "channels") {
      return jsonResponse({ items: params.forHandle ? channels : [] });
    }

    if (endpoint === "playlists") {
      if (params.id) {
        return jsonResponse({ items: playlistById ? [playlistById] : [] });
      }

      const page = pageFor(playlistPages, params.pageToken);

      return jsonResponse({ items: page.items ?? [], nextPageToken: page.nextPageToken });
    }

    if (endpoint === "playlistItems") {
      const page = pageFor(itemPages, params.pageToken);

      return jsonResponse({ items: page.items ?? [], nextPageToken: page.nextPageToken });
    }

    return jsonResponse({ items: [] });
  };

  fetchImpl.calls = calls;
  fetchImpl.endpoints = () => calls.map((call) => call.endpoint);
  fetchImpl.paramsFor = (endpoint) => calls.find((call) => call.endpoint === endpoint)?.params ?? null;

  return fetchImpl;
}
