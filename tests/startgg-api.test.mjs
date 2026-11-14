import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  StartggError,
  buildTournamentInfo,
  extractMeta,
  fetchCurrentUserId,
  fetchEmbedMeta,
  fetchOwnerTournaments,
  fetchTournamentDetails,
  mapTournament,
} from "../scripts/lib/startgg.mjs";
import { createStartggFetch } from "./helpers/api.mjs";
import { tournamentDetails } from "./fixtures/shapes.mjs";

const TOKEN = "startgg-token-SECRET";

async function expectError(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    assert.match(error.message, pattern);

    return error;
  }

  assert.fail(`expected a failure matching ${pattern}`);
}

describe("fetchCurrentUserId", () => {
  it("returns the owner id and sends the bearer token", async () => {
    const fetchImpl = createStartggFetch({ currentUser: { currentUser: { id: 777, username: "kwtekken" } } });

    assert.equal(await fetchCurrentUserId({ fetchImpl, token: TOKEN }), 777);
    assert.equal(fetchImpl.header("Authorization"), `Bearer ${TOKEN}`);
    assert.deepEqual(fetchImpl.operations(), ["CurrentUser"]);
  });

  it("fails when currentUser is null", async () => {
    const fetchImpl = createStartggFetch({ currentUser: { currentUser: null } });

    await expectError(fetchCurrentUserId({ fetchImpl, token: TOKEN }), /no user/);
  });

  it("reports HTTP 401 without repeating the token", async () => {
    const fetchImpl = createStartggFetch({ http: { CurrentUser: 401 } });
    const error = await expectError(fetchCurrentUserId({ fetchImpl, token: TOKEN }), /HTTP 401/);

    assert.doesNotMatch(error.message, /startgg-token-SECRET/);
    assert.match(error.message, /check STARTGG_TOKEN/);
  });

  it("surfaces GraphQL errors", async () => {
    const fetchImpl = createStartggFetch({ graphqlErrors: { CurrentUser: [{ message: "Bad credentials" }] } });
    const error = await expectError(
      fetchCurrentUserId({ fetchImpl, token: TOKEN }),
      /GraphQL error: Bad credentials/,
    );

    assert.doesNotMatch(error.message, /startgg-token-SECRET/);
  });

  it("reports network failures", async () => {
    const fetchImpl = createStartggFetch({ networkError: { CurrentUser: "socket hang up" } });

    await expectError(fetchCurrentUserId({ fetchImpl, token: TOKEN }), /request failed: socket hang up/);
  });
});

describe("fetchOwnerTournaments", () => {
  it("walks every page until the declared page count", async () => {
    const fetchImpl = createStartggFetch({
      tournamentPages: [
        {
          nodes: [
            { id: 1, slug: "tournament/a", startAt: 100 },
            { id: 2, slug: "tournament/b", startAt: 90 },
          ],
          pageInfo: { total: 3, page: 1, pageCount: 2 },
        },
        {
          nodes: [{ id: 3, slug: "tournament/c", startAt: 80 }],
          pageInfo: { total: 3, page: 2, pageCount: 2 },
        },
        { nodes: [{ id: 99, slug: "tournament/never-fetched", startAt: 1 }] },
      ],
    });
    const { tournaments, pages } = await fetchOwnerTournaments({ fetchImpl, token: TOKEN, ownerId: 7, perPage: 2 });

    assert.equal(pages, 2);
    assert.deepEqual(tournaments.map((entry) => entry.slug), ["tournament/a", "tournament/b", "tournament/c"]);
    assert.deepEqual(
      fetchImpl.calls.map((call) => call.variables.page),
      [1, 2],
    );
  });

  it("keeps paging while a full page arrives even without page info", async () => {
    const fullPage = { nodes: [{ id: 1, slug: "tournament/a", startAt: 1 }, { id: 2, slug: "tournament/b", startAt: 2 }] };
    const fetchImpl = createStartggFetch({
      tournamentPages: [fullPage, fullPage, { nodes: [{ id: 3, slug: "tournament/c", startAt: 3 }] }],
    });
    const { tournaments, pages } = await fetchOwnerTournaments({ fetchImpl, token: TOKEN, perPage: 2, maxPages: 5 });

    assert.equal(pages, 3);
    assert.equal(tournaments.length, 3, "duplicate ids collapse");
  });

  it("respects the page cap", async () => {
    const fullPage = { nodes: [{ id: 1, slug: "tournament/a", startAt: 1 }, { id: 2, slug: "tournament/b", startAt: 2 }] };
    const fetchImpl = createStartggFetch({ tournamentPages: [fullPage, fullPage, fullPage, fullPage, fullPage] });
    const { pages } = await fetchOwnerTournaments({ fetchImpl, token: TOKEN, perPage: 2, maxPages: 2 });

    assert.equal(pages, 2);
  });

  it("fails on HTTP 500 and on an empty result", async () => {
    await expectError(
      fetchOwnerTournaments({ fetchImpl: createStartggFetch({ http: { OwnerTournaments: 500 } }), token: TOKEN, ownerId: 1 }),
      /HTTP 500/,
    );

    const empty = await expectError(
      fetchOwnerTournaments({ fetchImpl: createStartggFetch({ tournamentPages: [] }), token: TOKEN, ownerId: 1 }),
      /no tournaments/,
    );

    assert.equal(empty.kind, "empty");
  });

  it("fails when the GraphQL error array is present", async () => {
    const error = await expectError(
      fetchOwnerTournaments({
        fetchImpl: createStartggFetch({ graphqlErrors: { OwnerTournaments: [{ message: "too many requests" }] } }),
        token: TOKEN,
        ownerId: 1,
      }),
      /GraphQL error: too many requests/,
    );

    assert.doesNotMatch(error.message, /startgg-token-SECRET/);
  });
});

describe("fetchTournamentDetails and mapping", () => {
  it("returns the tournament payload", async () => {
    const details = tournamentDetails({ slug: "tournament/basement-brawl-11" });
    const fetchImpl = createStartggFetch({ details });

    const fetched = await fetchTournamentDetails({ fetchImpl, token: TOKEN, slug: "tournament/basement-brawl-11" });

    assert.equal(fetched.name, details.name);
    assert.deepEqual(fetchImpl.calls[0].variables, { slug: "tournament/basement-brawl-11" });
  });

  it("fails when the slug resolves to nothing", async () => {
    const error = await expectError(
      fetchTournamentDetails({ fetchImpl: createStartggFetch({ details: null }), token: TOKEN, slug: "tournament/ghost" }),
      /no tournament for slug "tournament\/ghost"/,
    );

    assert.equal(error.kind, "empty");
  });

  it("flattens the API tournament into the feed shape", () => {
    const details = tournamentDetails({
      startAt: 1797000000,
      events: [
        { id: 1, name: "Open", slug: "s1", startAt: null, numEntrants: 12, videogame: { name: "Tekken 8" } },
        { id: 2, name: "Doubles", slug: "s2", startAt: 1797003600, numEntrants: null, videogame: null },
      ],
    });
    const mapped = mapTournament(details);

    assert.deepEqual(
      mapped.events,
      [
        { id: 1, name: "Open", slug: "s1", startAt: 1797000000, numEntrants: 12, videogame: "Tekken 8" },
        { id: 2, name: "Doubles", slug: "s2", startAt: 1797003600, numEntrants: null, videogame: "" },
      ],
    );
    assert.equal(mapped.region, "ON");
    assert.deepEqual(mapTournament({ name: "X" }).events, []);
  });

  it("keeps checked-in details only when the slug is unchanged", () => {
    const previous = {
      startAt: 111,
      venueAddress: "17 Benton St",
      city: "Kitchener",
      region: "ON",
      embedTitle: "Old title",
    };
    const mapped = {
      name: "Basement Brawl 11",
      slug: "tournament/basement-brawl-11",
      startAt: 222,
      endAt: null,
      venueAddress: "",
      city: "",
      region: "",
      countryCode: "CA",
      events: [],
    };
    const preserved = buildTournamentInfo({ mapped, previous, preserve: true, embed: { embedTitle: "New" } });

    assert.equal(preserved.startAt, 111);
    assert.equal(preserved.venueAddress, "17 Benton St");
    assert.equal(preserved.city, "Kitchener");
    assert.equal(preserved.region, "ON");
    assert.equal(preserved.embedTitle, "New");
    assert.equal(preserved.embedDescription, null);

    const replaced = buildTournamentInfo({ mapped, previous, preserve: false, embed: {} });

    assert.equal(replaced.startAt, 222);
    assert.equal(replaced.venueAddress, "");
    assert.equal(replaced.city, "Kitchener-Waterloo");
    assert.equal(replaced.region, "ON");
  });
});

describe("start.gg embed metadata", () => {
  it("reads og: meta tags in either attribute order", () => {
    const html = `
      <meta content="A" property="og:title">
      <meta name="og:description" content="B &amp; C">
      <meta property="og:image" content="https://img/A.png"/>`;

    assert.equal(extractMeta(html, "og:title"), "A");
    assert.equal(extractMeta(html, "og:description"), "B & C");
    assert.equal(extractMeta(html, "og:image"), "https://img/A.png");
    assert.equal(extractMeta(html, "og:missing"), null);
    assert.equal(extractMeta("", "og:title"), null);
  });

  it("decodes the entities start.gg uses", () => {
    assert.equal(
      extractMeta(`<meta property="og:title" content="Caf&eacute; &quot;T7&quot; &#39;&amp;&#39;">`, "og:title"),
      'Caf&eacute; "T7" \'&\'',
    );
  });

  it("fetches and maps all three fields", async () => {
    const fetchImpl = createStartggFetch({});
    const embed = await fetchEmbedMeta({ fetchImpl, url: "https://www.start.gg/tournament/x/details" });

    assert.equal(embed.embedTitle, "Basement Brawl #11 (T7 EDITION)");
    assert.equal(embed.embedImageUrl, "https://images.start.gg/images/tournament/999/image.png");
    assert.match(embed.embedDescription, /brackets & streams 'all in one'\./);
  });

  it("throws on HTTP and network failures so callers can keep the old fields", async () => {
    await expectError(
      fetchEmbedMeta({ fetchImpl: createStartggFetch({ http: { embed: 503 } }), url: "https://www.start.gg/t/x" }),
      /embed fetch returned HTTP 503/,
    );
    await expectError(
      fetchEmbedMeta({ fetchImpl: createStartggFetch({ networkError: { embed: "fetch failed" } }), url: "https://x" }),
      /embed fetch failed: fetch failed/,
    );
    await assert.rejects(() => fetchEmbedMeta({ fetchImpl: createStartggFetch({}), url: "" }), StartggError);
  });
});
