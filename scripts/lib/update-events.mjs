import { isoNow } from "./clock.mjs";
import { hasMeaningfulChange, readJsonFile, writeJsonAtomic } from "./io.mjs";
import { EVENTS_OUT_FILE } from "./paths.mjs";
import { redactSecrets } from "./secrets.mjs";
import { projectEventFeed, validateEventFeed } from "./schema.mjs";
import {
  DEFAULT_GRACE_HOURS,
  DEFAULT_MAX_PAGES,
  DEFAULT_PER_PAGE,
  STARTGG_BASE_URL,
  StartggError,
  buildTournamentInfo,
  extractTournamentSlug,
  fetchCurrentUserId,
  fetchEmbedMeta,
  fetchOwnerTournaments,
  fetchTournamentDetails,
  mapTournament,
  selectTournament,
  startggTournamentUrl,
} from "./startgg.mjs";

function envValue(env, name) {
  const value = env?.[name];

  return typeof value === "string" ? value.trim() : "";
}

function graceHoursFrom(env) {
  const raw = envValue(env, "STARTGG_GRACE_HOURS");

  if (!raw) return DEFAULT_GRACE_HOURS;

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_HOURS;
}

function perPageFrom(env) {
  const parsed = Number(envValue(env, "STARTGG_PER_PAGE"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PER_PAGE;
}

function maxPagesFrom(env) {
  const parsed = Number(envValue(env, "STARTGG_MAX_PAGES"));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES;
}

function previousEmbedFields(previous) {
  return {
    embedTitle: previous?.embedTitle ?? null,
    embedDescription: previous?.embedDescription ?? null,
    embedImageUrl: previous?.embedImageUrl ?? null,
  };
}

/**
 * Embed metadata is a nice-to-have: a failure must never sink a run, so callers
 * get the previous fields back plus a warning.
 */
async function refreshEmbed({ fetchImpl, url, previous, warn, env }) {
  if (!url) return { embed: previousEmbedFields(previous), ok: false, reason: "no start.gg URL available" };

  try {
    return { embed: await fetchEmbedMeta({ fetchImpl, url }), ok: true, reason: null };
  } catch (error) {
    const message = redactSecrets(error?.message ?? String(error), env);

    warn(`start.gg embed metadata fetch failed (${message}). Keeping the previous embed fields.`);

    return { embed: previousEmbedFields(previous), ok: false, reason: message };
  }
}

/**
 * Keeps public/events.json in step with the next start.gg tournament, either by
 * discovering it from the owner's account or from an explicit slug/URL override.
 */
export async function runUpdateEvents(options = {}) {
  const {
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    outFile = EVENTS_OUT_FILE,
    fs,
    dryRun = false,
    log = () => {},
    warn = () => {},
    error = () => {},
  } = options;

  const ioOptions = fs ? { fs } : {};
  const token = envValue(env, "STARTGG_TOKEN");
  const overrideUrl = envValue(env, "STARTGG_SOURCE_URL");
  const overrideSlug = extractTournamentSlug(overrideUrl) || extractTournamentSlug(envValue(env, "STARTGG_TOURNAMENT_SLUG"));
  const hasOverride = Boolean(overrideSlug || overrideUrl);
  const previousFile = await readJsonFile(outFile, ioOptions);
  const previous = previousFile.data;

  if (previousFile.error) {
    warn(`Could not parse ${outFile}; rebuilding it from the start.gg API.`);
  }

  const previousTournament = previous?.tournament ?? null;

  const fail = (message) => {
    const safeMessage = redactSecrets(message, env);

    error(`${safeMessage} Keeping the existing file untouched.`);

    return {
      status: "failed",
      exitCode: 1,
      outFile,
      changed: false,
      message: safeMessage,
      feed: null,
      selected: null,
    };
  };

  // No token means no discovery: keep the checked-in feed, refresh og: meta only.
  if (!token) {
    const fallbackSlug = previousTournament?.slug;
    const targetUrl = overrideUrl || startggTournamentUrl(overrideSlug || fallbackSlug) || previous?.sourceUrl || "";

    if (!targetUrl) {
      warn(
        `STARTGG_TOKEN is not set and there is no start.gg source URL to refresh; keeping ${outFile} as it is.`,
      );

      return {
        status: "skipped",
        exitCode: 0,
        outFile,
        changed: false,
        written: false,
        message: "No token and no start.gg source URL.",
        feed: previous ?? null,
        selected: null,
      };
    }

    const { embed, ok } = await refreshEmbed({ fetchImpl, url: targetUrl, previous: previousTournament, warn, env });
    const feed = projectEventFeed({
      sourceUrl: targetUrl || previous?.sourceUrl || "",
      generatedAt: ok ? isoNow(now) : previous?.generatedAt ?? null,
      tournament: { ...(previousTournament ?? {}), ...embed },
      events: previous?.events ?? [],
    }).value;
    const changed = hasMeaningfulChange(previous, feed);

    if (changed && !dryRun) await writeJsonAtomic(outFile, feed, ioOptions);

    warn(
      "STARTGG_TOKEN is not set. Refreshed start.gg embed metadata only; the featured tournament is unchanged.",
    );

    return {
      status: "embed-only",
      exitCode: 0,
      outFile,
      changed,
      written: changed && !dryRun,
      feed,
      selected: {
        source: hasOverride ? "env" : "checked-in",
        slug: extractTournamentSlug(feed.tournament.slug) ?? "",
        name: feed.tournament.name ?? "",
        startAt: feed.tournament.startAt ?? null,
        sourceUrl: feed.sourceUrl,
      },
    };
  }

  try {
    let slug = overrideSlug;
    let sourceUrl = overrideUrl || null;
    let source = "env";
    let kind = "override";

    if (!slug) {
      const ownerId = await fetchCurrentUserId({ fetchImpl, token });
      const { tournaments, pages } = await fetchOwnerTournaments({
        fetchImpl,
        token,
        ownerId,
        perPage: perPageFrom(env),
        maxPages: maxPagesFrom(env),
      });
      const selection = selectTournament(tournaments, { now, graceHours: graceHoursFrom(env) });

      if (!selection.tournament) {
        throw new StartggError(
          `start.gg returned ${selection.total} tournament(s) but none with a usable start date.`,
          { kind: "empty" },
        );
      }

      slug = extractTournamentSlug(selection.tournament.slug);

      if (!slug) {
        throw new StartggError(
          `start.gg tournament "${selection.tournament?.name ?? selection.tournament?.id}" has no usable slug.`,
          { kind: "empty" },
        );
      }

      kind = selection.kind;
      source = "discovered";
      sourceUrl = startggTournamentUrl(slug);
      log(
        `Selected ${kind === "upcoming" ? "upcoming" : "most recent"} start.gg tournament: ${
          selection.tournament.name
        } (${slug}) across ${pages} page(s).`,
      );
    }

    sourceUrl = sourceUrl || startggTournamentUrl(slug);

    const details = await fetchTournamentDetails({ fetchImpl, token, slug });
    const mapped = mapTournament(details, { fallbackSlug: slug });

    if (!mapped.name) {
      throw new StartggError(`start.gg returned a tournament with no name for slug "${slug}".`, {
        kind: "empty",
      });
    }

    const preserveCheckedIn =
      previousTournament?.slug === mapped.slug || previous?.sourceUrl === sourceUrl;
    const { embed } = await refreshEmbed({ fetchImpl, url: sourceUrl, previous: previousTournament, warn, env });
    const projection = projectEventFeed({
      sourceUrl: sourceUrl || STARTGG_BASE_URL,
      generatedAt: isoNow(now),
      tournament: buildTournamentInfo({ mapped, previous: previousTournament, preserve: preserveCheckedIn, embed }),
      events: mapped.events,
    });
    const feed = projection.value;
    const problems = validateEventFeed(feed);

    if (problems.length) {
      throw new StartggError(`Refusing to write an invalid events feed: ${problems.join("; ")}`, {
        kind: "schema",
      });
    }

    const changed = hasMeaningfulChange(previous, feed);

    // A refresh that only moved generatedAt must not dirty the working tree.
    if (changed && !dryRun) await writeJsonAtomic(outFile, feed, ioOptions);

    log(
      `${dryRun ? "Would write" : changed ? "Wrote" : "Kept"} ${outFile}: ${feed.tournament.name} with ${
        feed.events.length
      } event(s).`,
    );

    return {
      status: "updated",
      exitCode: 0,
      outFile,
      changed,
      written: changed && !dryRun,
      feed,
      selected: {
        source,
        kind,
        slug: mapped.slug,
        name: mapped.name,
        startAt: feed.tournament.startAt,
        sourceUrl: feed.sourceUrl,
      },
    };
  } catch (caught) {
    return fail(caught?.message ?? String(caught));
  }
}