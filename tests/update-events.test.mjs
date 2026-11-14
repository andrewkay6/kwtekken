import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { EVENT_FEED_KEYS, SCENE_EVENT_KEYS, TOURNAMENT_KEYS } from "../scripts/lib/schema.mjs";
import { runUpdateEvents } from "../scripts/lib/update-events.mjs";
import { createStartggFetch } from "./helpers/api.mjs";
import { capture, fixedNow, hoursFromNow, makeSandbox } from "./helpers/sandbox.mjs";
import { ownedTournament, previousFeed, tournamentDetails } from "./fixtures/shapes.mjs";

const CLI = resolve(import.meta.dirname, "../scripts/update-events.mjs");
const NOW = "2026-11-14T12:00:00.000Z";
const TOKEN = "startgg-secret-token-value";

const sandboxes = [];

after(async () => {
  await Promise.all(sandboxes.map((sandbox) => sandbox.cleanup()));
});

async function sandboxWith(events) {
  const sandbox = await makeSandbox({ events });

  sandboxes.push(sandbox);

  return sandbox;
}

function upcoming(slug = "tournament/basement-brawl-11", overrides = {}) {
  return ownedTournament({ slug, startAt: hoursFromNow(24 * 5), ...overrides });
}

function run({ sandbox, env = {}, fetchImpl, options = {} } = {}) {
  const captured = capture();

  return runUpdateEvents({
    env: { STARTGG_TOKEN: TOKEN, ...env },
    fetchImpl: fetchImpl ?? createStartggFetch({}),
    now: fixedNow(NOW),
    outFile: sandbox.eventsFile,
    ...captured.loggers,
    ...options,
  }).then((result) => Object.assign(result, { capture: captured }));
}

describe("update-events: discovery", () => {
  it("features the next tournament and rebuilds the feed", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const before = await sandbox.read("events.json");
    const fetchImpl = createStartggFetch({
      tournamentPages: [[upcoming()]],
      details: tournamentDetails({ slug: "tournament/basement-brawl-11" }),
    });
    const result = await run({ sandbox, fetchImpl });

    assert.equal(result.status, "updated");
    assert.equal(result.exitCode, 0);
    assert.equal(result.changed, true);
    assert.equal(result.selected.kind, "upcoming");
    assert.equal(result.selected.source, "discovered");

    const feed = await sandbox.readJson("events.json");

    assert.equal(feed.sourceUrl, "https://www.start.gg/tournament/basement-brawl-11/details");
    assert.equal(feed.generatedAt, NOW);
    assert.equal(feed.tournament.name, "Basement Brawl 11: T7 Edition");
    assert.equal(feed.tournament.slug, "tournament/basement-brawl-11");
    assert.equal(feed.tournament.startAt, 1797000000);
    assert.equal(feed.tournament.embedTitle, "Basement Brawl #11 (T7 EDITION)");
    assert.equal(feed.tournament.embedImageUrl, "https://images.start.gg/images/tournament/999/image.png");
    assert.equal(feed.events.length, 2);
    assert.deepEqual(feed.events[0], {
      id: 5001,
      name: "Tekken 8 - Open Bracket",
      slug: "tournament/basement-brawl-11/tekken-8-open",
      startAt: 1797000000,
      numEntrants: 32,
      videogame: "Tekken 8",
    });
    assert.notEqual(await sandbox.read("events.json"), before);
    assert.deepEqual(fetchImpl.operations(), ["CurrentUser", "OwnerTournaments", "TournamentEvents", "embed"]);
    assert.deepEqual(await sandbox.entries(), ["events.json", "videos.json"]);
  });

  it("keeps the checked-in date and venue when the slug has not changed", async () => {
    const slug = "tournament/basement-brawl-11";
    const sandbox = await sandboxWith(
      previousFeed({
        sourceUrl: `https://www.start.gg/${slug}/details`,
        tournament: {
          name: "Checked in name",
          slug,
          startAt: hoursFromNow(48),
          endAt: null,
          venueAddress: "17 Benton St, Kitchener, ON N2G 1V8, Canada",
          city: "Kitchener",
          region: "ON",
          countryCode: "CA",
        },
      }),
    );
    const result = await run({
      sandbox,
      fetchImpl: createStartggFetch({
        tournamentPages: [[upcoming(slug)]],
        details: tournamentDetails({ slug, startAt: null, venueAddress: "", city: "", addrState: "" }),
      }),
    });
    const feed = await sandbox.readJson("events.json");

    assert.equal(result.selected.source, "discovered");
    assert.equal(feed.tournament.slug, slug);
    assert.equal(feed.tournament.startAt, hoursFromNow(48));
    assert.equal(feed.tournament.venueAddress, "17 Benton St, Kitchener, ON N2G 1V8, Canada");
    assert.equal(feed.tournament.city, "Kitchener");
    assert.equal(feed.tournament.region, "ON");
    assert.equal(feed.tournament.name, "Basement Brawl 11: T7 Edition");
  });

  it("falls back to the most recent past tournament when nothing is upcoming", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const past = ownedTournament({ slug: "tournament/basement-brawl-9", startAt: hoursFromNow(-24 * 6) });
    const result = await run({
      sandbox,
      fetchImpl: createStartggFetch({ tournamentPages: [[past]], details: tournamentDetails({ slug: past.slug }) }),
    });

    assert.equal(result.status, "updated");
    assert.equal(result.selected.kind, "recent-past");
    assert.equal((await sandbox.readJson("events.json")).tournament.slug, "tournament/basement-brawl-9");
  });

  it("honours the 12h grace window so a running event stays featured", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const running = ownedTournament({ slug: "tournament/running-now", startAt: hoursFromNow(-2) });
    const result = await run({
      sandbox,
      fetchImpl: createStartggFetch({ tournamentPages: [[running]], details: tournamentDetails({ slug: running.slug }) }),
    });

    assert.equal(result.selected.kind, "upcoming");
    assert.equal(result.selected.slug, "tournament/running-now");
  });

  it("walks several pages of tournaments", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const next = upcoming("tournament/basement-brawl-12");
    const fetchImpl = createStartggFetch({
      tournamentPages: [
        { nodes: [ownedTournament({ slug: "tournament/a", startAt: hoursFromNow(-24 * 40) })], pageInfo: { totalPages: 2 } },
        { nodes: [next], pageInfo: { totalPages: 2 } },
      ],
      details: tournamentDetails({ slug: next.slug }),
    });
    const result = await run({ sandbox, fetchImpl, env: { STARTGG_PER_PAGE: "1" } });

    assert.equal(result.selected.slug, next.slug);
    assert.deepEqual(
      fetchImpl.calls.filter((call) => call.operation === "OwnerTournaments").map((call) => call.variables.page),
      [1, 2],
    );
  });
});

describe("update-events: env overrides win", () => {
  it("uses STARTGG_TOURNAMENT_SLUG and skips discovery", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const slug = "tournament/some-other-event";
    const fetchImpl = createStartggFetch({
      tournamentPages: [[upcoming()]],
      details: tournamentDetails({ slug, name: "Some Other Event" }),
    });
    const result = await run({ sandbox, env: { STARTGG_TOURNAMENT_SLUG: slug }, fetchImpl });

    assert.equal(result.selected.source, "env");
    assert.deepEqual(fetchImpl.operations(), ["TournamentEvents", "embed"]);
    assert.equal(fetchImpl.calls[0].variables.slug, slug);
    assert.equal((await sandbox.readJson("events.json")).sourceUrl, `https://www.start.gg/${slug}/details`);
  });

  it("normalizes a bare slug and prefers STARTGG_SOURCE_URL", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const url = "https://www.start.gg/tournament/from-url/details?tab=brackets";
    const fetchImpl = createStartggFetch({ details: tournamentDetails({ slug: "tournament/from-url" }) });
    const result = await run({ sandbox, env: { STARTGG_SOURCE_URL: url }, fetchImpl });

    assert.equal(result.selected.slug, "tournament/from-url");
    assert.equal((await sandbox.readJson("events.json")).sourceUrl, url);
    assert.deepEqual(fetchImpl.operations(), ["TournamentEvents", "embed"]);
  });

  it("lets the source URL override beat the slug override", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const fetchImpl = createStartggFetch({ details: tournamentDetails({ slug: "tournament/url-wins" }) });
    const result = await run({
      sandbox,
      env: {
        STARTGG_TOURNAMENT_SLUG: "tournament/slug-loses",
        STARTGG_SOURCE_URL: "https://www.start.gg/tournament/url-wins/details",
      },
      fetchImpl,
    });

    assert.equal(result.selected.slug, "tournament/url-wins");
    assert.equal(fetchImpl.calls[0].variables.slug, "tournament/url-wins");
  });

  it("honours a custom grace window", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const startedYesterday = ownedTournament({ slug: "tournament/yesterday", startAt: hoursFromNow(-30) });
    const fetchImpl = createStartggFetch({
      tournamentPages: [[startedYesterday]],
      details: tournamentDetails({ slug: startedYesterday.slug }),
    });
    const short = await run({ sandbox, env: { STARTGG_GRACE_HOURS: "1" }, fetchImpl });
    const long = await run({ sandbox, env: { STARTGG_GRACE_HOURS: "72" }, fetchImpl });

    assert.equal(short.selected.kind, "recent-past");
    assert.equal(long.selected.kind, "upcoming");
  });
});

describe("update-events: embed metadata never sinks a run", () => {
  it("keeps the previous embed fields when the fetch fails during a token run", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const fetchImpl = createStartggFetch({
      tournamentPages: [[upcoming()]],
      details: tournamentDetails({ slug: "tournament/basement-brawl-11" }),
      http: { embed: 503 },
    });
    const result = await run({ sandbox, fetchImpl });

    assert.equal(result.status, "updated");
    assert.equal(result.exitCode, 0);
    assert.match(result.capture.text(), /Keeping the previous embed fields/);

    const feed = await sandbox.readJson("events.json");

    assert.equal(feed.tournament.embedTitle, "Basement Brawl #10 (CAFÉ EDITION)");
    assert.equal(feed.tournament.embedImageUrl, "https://images.start.gg/images/tournament/969660/old.png");
    assert.equal(feed.tournament.name, "Basement Brawl 11: T7 Edition");
  });

  it("treats a missing og:image as null without failing", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const fetchImpl = createStartggFetch({
      tournamentPages: [[upcoming()]],
      details: tournamentDetails({ slug: "tournament/basement-brawl-11" }),
      embedHtml: "<html><head><meta property=\"og:title\" content=\"Only a title\"></head></html>",
    });
    const result = await run({ sandbox, fetchImpl });
    const feed = await sandbox.readJson("events.json");

    assert.equal(result.exitCode, 0);
    assert.equal(feed.tournament.embedTitle, "Only a title");
    assert.equal(feed.tournament.embedImageUrl, null);
    assert.equal(feed.tournament.embedDescription, null);
  });
});

describe("update-events: without a token", () => {
  it("keeps the feed and refreshes only the embed metadata", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const fetchImpl = createStartggFetch({ tournamentPages: [[upcoming()]] });
    const result = await run({ sandbox, env: { STARTGG_TOKEN: "" }, fetchImpl });

    assert.equal(result.status, "embed-only");
    assert.equal(result.exitCode, 0);
    assert.equal(result.changed, true);
    assert.deepEqual(fetchImpl.operations(), ["embed"]);
    assert.match(result.capture.text(), /STARTGG_TOKEN is not set/);

    const feed = await sandbox.readJson("events.json");

    assert.equal(feed.tournament.slug, "tournament/basement-brawl-10-caf-edition");
    assert.equal(feed.tournament.startAt, 1793921400);
    assert.equal(feed.tournament.embedTitle, "Basement Brawl #11 (T7 EDITION)");
    assert.equal(feed.generatedAt, NOW);
  });

  it("does not rewrite the file and keeps the old embed fields when the embed fetch fails", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const before = await sandbox.read("events.json");
    const result = await run({
      sandbox,
      env: { STARTGG_TOKEN: "" },
      fetchImpl: createStartggFetch({ http: { embed: 500 } }),
    });

    assert.equal(result.status, "embed-only");
    assert.equal(result.exitCode, 0);
    assert.equal(result.changed, false);
    assert.equal(result.written, false);
    assert.match(result.capture.text(), /Keeping the previous embed fields/);
    assert.equal(await sandbox.read("events.json"), before);
  });

  it("says so when there is neither a token nor a feed to refresh", async () => {
    const sandbox = await sandboxWith({ sourceUrl: "", generatedAt: null, tournament: {}, events: [] });
    const result = await run({ sandbox, env: { STARTGG_TOKEN: "" }, fetchImpl: createStartggFetch({}) });

    assert.equal(result.status, "skipped");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.capture.lines.filter((line) => line.startsWith("log:")), []);
  });
});

describe("update-events: API failures keep the good file", () => {
  const cases = [
    {
      name: "HTTP 401 from currentUser",
      fetchImpl: () => createStartggFetch({ http: { CurrentUser: 401 } }),
      pattern: /HTTP 401/,
    },
    {
      name: "HTTP 500 from tournaments",
      fetchImpl: () => createStartggFetch({ tournamentPages: [[upcoming()]], http: { OwnerTournaments: 500 } }),
      pattern: /HTTP 500/,
    },
    {
      name: "a GraphQL errors array",
      fetchImpl: () =>
        createStartggFetch({
          details: null,
          tournamentPages: [[upcoming()]],
          graphqlErrors: { TournamentEvents: [{ message: "Something went wrong" }] },
        }),
      pattern: /GraphQL error: Something went wrong/,
    },
    {
      name: "a null currentUser",
      fetchImpl: () => createStartggFetch({ currentUser: { currentUser: null } }),
      pattern: /no user/,
    },
    {
      name: "an empty tournament list",
      fetchImpl: () => createStartggFetch({ tournamentPages: [] }),
      pattern: /no tournaments/,
    },
    {
      name: "tournaments without any start date",
      fetchImpl: () => createStartggFetch({ tournamentPages: [[ownedTournament({ startAt: null })]] }),
      pattern: /none with a usable start date/,
    },
    {
      name: "a slug that resolves to no tournament",
      fetchImpl: () => createStartggFetch({ tournamentPages: [[upcoming()]], details: null }),
      pattern: /no tournament for slug/,
    },
    {
      name: "a tournament with no name",
      fetchImpl: () =>
        createStartggFetch({
          tournamentPages: [[upcoming()]],
          details: tournamentDetails({ name: "" }),
        }),
      pattern: /no name/,
    },
    {
      name: "a network failure",
      fetchImpl: () => createStartggFetch({ networkError: { CurrentUser: "fetch failed" } }),
      pattern: /request failed: fetch failed/,
    },
  ];

  for (const testCase of cases) {
    it(`leaves events.json untouched on ${testCase.name}`, async () => {
      const sandbox = await sandboxWith(previousFeed());
      const before = await sandbox.read("events.json");
      const result = await run({ sandbox, fetchImpl: testCase.fetchImpl() });

      assert.equal(result.status, "failed");
      assert.equal(result.exitCode, 1);
      assert.match(result.message, testCase.pattern);
      assert.match(result.capture.text(), /Keeping the existing file untouched/);
      assert.equal(await sandbox.read("events.json"), before, "file must be unchanged");
      assert.deepEqual(await sandbox.entries(), ["events.json", "videos.json"], "no temp file left behind");
      assert.doesNotMatch(result.capture.text(), /startgg-secret-token-value/, "token must not be printed");
      assert.doesNotMatch(result.message, /startgg-secret-token-value/);
    });
  }

  it("does not write in dry-run mode", async () => {
    const sandbox = await sandboxWith(previousFeed());
    const before = await sandbox.read("events.json");
    const result = await run({
      sandbox,
      fetchImpl: createStartggFetch({
        tournamentPages: [[upcoming()]],
        details: tournamentDetails({ slug: "tournament/basement-brawl-11" }),
      }),
      options: { dryRun: true },
    });

    assert.equal(result.status, "updated");
    assert.equal(result.changed, true);
    assert.equal(result.written, false);
    assert.equal(await sandbox.read("events.json"), before);
    assert.match(result.capture.text(), /Would write/);
  });
});

describe("update-events: output shape", () => {
  it("emits only allow-listed keys and never the credentials in env", async () => {
    const polluted = previousFeed({
      token: "leaked-root",
      tournament: {
        name: "Basement Brawl 10: CAFÉ Edition",
        slug: "tournament/basement-brawl-10-caf-edition",
        startAt: 1793921400,
        authorization: "Bearer leaked",
      },
    });
    const sandbox = await sandboxWith(polluted);
    const result = await run({
      sandbox,
      env: { STARTGG_TOKEN: TOKEN, YOUTUBE_API_KEY: "youtube-secret-key-value" },
      fetchImpl: createStartggFetch({
        tournamentPages: [[upcoming()]],
        details: tournamentDetails({ slug: "tournament/basement-brawl-10-caf-edition" }),
      }),
    });
    const raw = await sandbox.read("events.json");
    const feed = JSON.parse(raw);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(Object.keys(feed), EVENT_FEED_KEYS);
    assert.deepEqual(Object.keys(feed.tournament).sort(), [...TOURNAMENT_KEYS].sort());

    for (const event of feed.events) {
      assert.deepEqual(Object.keys(event).sort(), [...SCENE_EVENT_KEYS].sort());
    }

    assert.doesNotMatch(raw, /leaked-root|Bearer leaked|startgg-secret-token-value|youtube-secret-key-value/);
  });

  it("strips unexpected keys from the checked-in feed in embed-only mode", async () => {
    const sandbox = await sandboxWith(previousFeed({ token: "leaked-root", tournament: { name: "X", slug: "tournament/basement-brawl-10-caf-edition", STARTGG_TOKEN: "leaked" } }));
    const result = await run({ sandbox, env: { STARTGG_TOKEN: "" }, fetchImpl: createStartggFetch({}) });
    const raw = await sandbox.read("events.json");

    assert.equal(result.status, "embed-only");
    assert.deepEqual(Object.keys(JSON.parse(raw)), EVENT_FEED_KEYS);
    assert.doesNotMatch(raw, /leaked/);
  });
});

describe("update-events: CLI wrapper", () => {
  it("runs end to end against a temp copy of public/", async () => {
    const { main } = await import("../scripts/update-events.mjs");
    const sandbox = await sandboxWith(previousFeed());
    const result = await main({
      argv: ["--out", sandbox.eventsFile],
      env: { STARTGG_TOKEN: TOKEN },
      fetchImpl: createStartggFetch({
        tournamentPages: [[upcoming()]],
        details: tournamentDetails({ slug: "tournament/basement-brawl-11" }),
      }),
      now: fixedNow(NOW),
      ...capture().loggers,
    });

    assert.equal(result.exitCode, 0);
    assert.equal((await sandbox.readJson("events.json")).tournament.slug, "tournament/basement-brawl-11");
  });

  it("supports --dry-run, --help and rejects unknown flags", async () => {
    const { main } = await import("../scripts/update-events.mjs");
    const sandbox = await sandboxWith(previousFeed());
    const before = await sandbox.read("events.json");
    const captured = capture();
    const dry = await main({
      argv: [`--out=${sandbox.eventsFile}`, "--dry-run"],
      env: { STARTGG_TOKEN: TOKEN },
      fetchImpl: createStartggFetch({
        tournamentPages: [[upcoming()]],
        details: tournamentDetails({ slug: "tournament/basement-brawl-11" }),
      }),
      now: fixedNow(NOW),
      ...captured.loggers,
    });

    assert.equal(dry.exitCode, 0);
    assert.equal(await sandbox.read("events.json"), before);

    const help = await main({ argv: ["--help"], ...capture().loggers });

    assert.equal(help.exitCode, 0);
    assert.match(help.status, /help/);

    const bad = await main({ argv: ["--nope"], ...capture().loggers });

    assert.equal(bad.exitCode, 2);
  });

  it("exits 0 as a real process when no token is configured", async () => {
    const sandbox = await sandboxWith({ sourceUrl: "", generatedAt: null, tournament: {}, events: [] });
    const run = spawnSync(process.execPath, [CLI, "--out", sandbox.eventsFile], {
      encoding: "utf8",
      env: { STARTGG_TOKEN: "" },
    });

    assert.equal(run.status, 0, run.stderr);
    assert.match(`${run.stderr}${run.stdout}`, /STARTGG_TOKEN is not set|no start.gg source URL/);
    assert.deepEqual(JSON.parse(await readFile(sandbox.eventsFile, "utf8")).tournament, {});
    assert.equal(dirname(sandbox.eventsFile).endsWith("public"), true);
  });
});
