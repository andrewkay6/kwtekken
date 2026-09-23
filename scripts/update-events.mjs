import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const STARTGG_API = "https://api.start.gg/gql/alpha";
const OUTFILE = resolve("public/events.json");

const token = process.env.STARTGG_TOKEN;
const currentFeed = JSON.parse(await readFile(OUTFILE, "utf8"));
const SOURCE_URL =
  process.env.STARTGG_SOURCE_URL ||
  currentFeed.sourceUrl ||
  "https://www.start.gg/tournament/basement-brawl-8-caf-edition/details";
const TOURNAMENT_SLUG =
  process.env.STARTGG_TOURNAMENT_SLUG ||
  currentFeed.tournament?.slug ||
  extractTournamentSlug(SOURCE_URL) ||
  "tournament/basement-brawl-8-caf-edition";
const currentTournament = currentFeed.tournament || {};
const shouldPreserveCheckedInDetails =
  currentTournament.slug === TOURNAMENT_SLUG ||
  currentFeed.sourceUrl === SOURCE_URL;
const embed = await fetchStartggEmbed(SOURCE_URL);

if (!token) {
  currentFeed.generatedAt = new Date().toISOString();
  currentFeed.sourceUrl = SOURCE_URL;
  currentFeed.tournament = {
    ...currentFeed.tournament,
    ...embed,
  };

  await writeEventsFeed(currentFeed, 0);
  console.warn("STARTGG_TOKEN is not set. Refreshed start.gg embed metadata only.");
} else {
  const query = `
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

  const response = await fetch(STARTGG_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      variables: { slug: TOURNAMENT_SLUG },
    }),
  });

  if (!response.ok) {
    throw new Error(`start.gg returned ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(
      `start.gg GraphQL error: ${payload.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  const tournament = payload.data?.tournament;

  if (!tournament) {
    throw new Error(`No tournament found for slug "${TOURNAMENT_SLUG}"`);
  }

  const events = (tournament.events || []).map((event) => ({
    id: event.id,
    name: event.name,
    slug: event.slug,
    startAt: event.startAt ?? tournament.startAt ?? null,
    numEntrants: event.numEntrants ?? null,
    videogame: event.videogame?.name ?? "",
  }));

  const feed = {
    sourceUrl: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    tournament: {
      name: tournament.name,
      slug: tournament.slug || TOURNAMENT_SLUG,
      startAt:
        shouldPreserveCheckedInDetails && currentTournament.startAt
          ? currentTournament.startAt
          : tournament.startAt ?? null,
      endAt: tournament.endAt ?? null,
      venueAddress:
        shouldPreserveCheckedInDetails && currentTournament.venueAddress
          ? currentTournament.venueAddress
          : tournament.venueAddress || "",
      city:
        shouldPreserveCheckedInDetails && currentTournament.city
          ? currentTournament.city
          : tournament.city || "Kitchener-Waterloo",
      region:
        shouldPreserveCheckedInDetails && currentTournament.region
          ? currentTournament.region
          : tournament.addrState || "ON",
      countryCode: tournament.countryCode || "CA",
      embedTitle: embed.embedTitle,
      embedDescription: embed.embedDescription,
      embedImageUrl: embed.embedImageUrl,
    },
    events,
  };

  await writeEventsFeed(feed, events.length);
}

function extractTournamentSlug(url) {
  const match = url.match(/start\.gg\/(tournament\/[^/?#]+)/i);
  return match ? match[1] : null;
}

async function fetchStartggEmbed(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`start.gg embed fetch returned ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();

  return {
    embedTitle: extractMeta(html, "og:title"),
    embedDescription: extractMeta(html, "og:description"),
    embedImageUrl: extractMeta(html, "og:image"),
  };
}

function extractMeta(html, property) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const match = html.match(pattern);

  return match ? decodeHtml(match[1]) : null;
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function writeEventsFeed(feed, eventCount) {
  await mkdir(dirname(OUTFILE), { recursive: true });
  await writeFile(`${OUTFILE}.tmp`, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  await rename(`${OUTFILE}.tmp`, OUTFILE);

  console.log(`Wrote ${OUTFILE} with ${eventCount} event(s).`);
}
