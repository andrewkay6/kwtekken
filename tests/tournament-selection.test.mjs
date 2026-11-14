import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_GRACE_HOURS,
  extractTournamentSlug,
  selectTournament,
  startggTournamentUrl,
} from "../scripts/lib/startgg.mjs";
import { hoursFromNow } from "./helpers/sandbox.mjs";

const NOW = () => new Date("2026-11-14T12:00:00.000Z");
const graceSeconds = DEFAULT_GRACE_HOURS * 3600;

describe("extractTournamentSlug", () => {
  it("normalizes full start.gg URLs", () => {
    assert.equal(
      extractTournamentSlug("https://www.start.gg/tournament/basement-brawl-10-caf-edition/details"),
      "tournament/basement-brawl-10-caf-edition",
    );
    assert.equal(
      extractTournamentSlug("https://start.gg/tournament/some-event/details/?fbrTab=brackets"),
      "tournament/some-event",
    );
    assert.equal(
      extractTournamentSlug("https://www.start.gg/tournament/some-event#sets"),
      "tournament/some-event",
    );
  });

  it("accepts an already normalized or bare slug", () => {
    assert.equal(extractTournamentSlug("tournament/basement-brawl-11"), "tournament/basement-brawl-11");
    assert.equal(extractTournamentSlug("/tournament/basement-brawl-11/"), "tournament/basement-brawl-11");
    assert.equal(extractTournamentSlug("basement-brawl-11"), "tournament/basement-brawl-11");
    assert.equal(extractTournamentSlug("  basement-brawl-11  "), "tournament/basement-brawl-11");
  });

  it("returns null for anything that is not a tournament reference", () => {
    for (const value of [null, undefined, "", "   ", 42, {}, "https://www.start.gg/", "not a slug / path"]) {
      assert.equal(extractTournamentSlug(value), null, String(value));
    }
  });
});

describe("startggTournamentUrl", () => {
  it("builds the details URL from a slug or URL", () => {
    assert.equal(
      startggTournamentUrl("tournament/basement-brawl-11"),
      "https://www.start.gg/tournament/basement-brawl-11/details",
    );
    assert.equal(
      startggTournamentUrl("https://www.start.gg/tournament/basement-brawl-11/details"),
      "https://www.start.gg/tournament/basement-brawl-11/details",
    );
    assert.equal(startggTournamentUrl(""), null);
  });
});

describe("selectTournament", () => {
  it("picks an upcoming tournament over a past one", () => {
    const past = { id: 1, slug: "tournament/past", startAt: hoursFromNow(-72) };
    const upcoming = { id: 2, slug: "tournament/next", startAt: hoursFromNow(48) };
    const selection = selectTournament([past, upcoming], { now: NOW });

    assert.equal(selection.kind, "upcoming");
    assert.equal(selection.tournament.slug, "tournament/next");
  });

  it("picks the soonest of several upcoming tournaments, ignoring input order", () => {
    const later = { id: 1, slug: "tournament/later", startAt: hoursFromNow(24 * 30) };
    const soonest = { id: 2, slug: "tournament/soonest", startAt: hoursFromNow(6) };
    const middle = { id: 3, slug: "tournament/middle", startAt: hoursFromNow(24 * 7) };

    for (const list of [
      [later, soonest, middle],
      [soonest, middle, later],
      [middle, later, soonest],
    ]) {
      const selection = selectTournament(list, { now: NOW });

      assert.equal(selection.kind, "upcoming");
      assert.equal(selection.tournament.slug, "tournament/soonest");
    }
  });

  it("treats a start exactly on the grace-window edge as still featured", () => {
    const nowSeconds = Math.floor(NOW().getTime() / 1000);
    const edge = { id: 1, slug: "tournament/edge", startAt: nowSeconds - graceSeconds };
    const selection = selectTournament([edge], { now: NOW });

    assert.equal(selection.cutoff, nowSeconds - graceSeconds);
    assert.equal(selection.kind, "upcoming");
    assert.equal(selection.tournament.slug, "tournament/edge");
  });

  it("drops a tournament one second past the grace window to recent-past", () => {
    const nowSeconds = Math.floor(NOW().getTime() / 1000);
    const justOld = { id: 1, slug: "tournament/just-old", startAt: nowSeconds - graceSeconds - 1 };
    const selection = selectTournament([justOld], { now: NOW });

    assert.equal(selection.kind, "recent-past");
    assert.equal(selection.tournament.slug, "tournament/just-old");
  });

  it("honours a custom grace window", () => {
    const startedTwoHoursAgo = { id: 1, slug: "tournament/running", startAt: hoursFromNow(-2) };

    assert.equal(selectTournament([startedTwoHoursAgo], { now: NOW, graceHours: 0 }).kind, "recent-past");
    assert.equal(
      selectTournament([startedTwoHoursAgo], { now: NOW, graceHours: 6 }).kind,
      "upcoming",
    );
  });

  it("falls back to the most recent past tournament when nothing is upcoming", () => {
    const older = { id: 1, slug: "tournament/older", startAt: hoursFromNow(-24 * 60) };
    const newest = { id: 2, slug: "tournament/newest", startAt: hoursFromNow(-24 * 3) };
    const middle = { id: 3, slug: "tournament/middle", startAt: hoursFromNow(-24 * 20) };
    const selection = selectTournament([older, newest, middle], { now: NOW });

    assert.equal(selection.kind, "recent-past");
    assert.equal(selection.tournament.slug, "tournament/newest");
  });

  it("ignores entries without a usable start date", () => {
    const undated = { id: 1, slug: "tournament/undated", startAt: null };
    const blank = { id: 2, slug: "tournament/blank", startAt: undefined };
    const zero = { id: 3, slug: "tournament/zero", startAt: 0 };
    const upcoming = { id: 4, slug: "tournament/real", startAt: hoursFromNow(12) };

    const selection = selectTournament([undated, blank, zero, upcoming], { now: NOW });

    assert.equal(selection.kind, "upcoming");
    assert.equal(selection.tournament.slug, "tournament/real");
    assert.equal(selection.considered, 1);
    assert.equal(selection.total, 4);
  });

  it("reports none when every candidate is undated or the list is empty", () => {
    for (const list of [[], [{ id: 1, slug: "tournament/a", startAt: null }], null, undefined]) {
      const selection = selectTournament(list, { now: NOW });

      assert.equal(selection.tournament, null);
      assert.equal(selection.kind, "none");
    }
  });

  it("coerces string start dates and breaks ties deterministically", () => {
    const sameTime = hoursFromNow(24);
    const list = [
      { id: 22, slug: "tournament/b", startAt: String(sameTime) },
      { id: 11, slug: "tournament/a", startAt: sameTime },
    ];
    const selection = selectTournament(list, { now: NOW });

    assert.equal(selection.tournament.slug, "tournament/a");
    assert.equal(selectTournament(list.slice().reverse(), { now: NOW }).tournament.slug, "tournament/a");
  });
});
