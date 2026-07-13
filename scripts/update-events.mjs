import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const STARTGG_API = "https://api.start.gg/gql/alpha";
const TOURNAMENT_SLUG =
  process.env.STARTGG_TOURNAMENT_SLUG || "tournament/basement-brawl-3-2";
const SOURCE_URL =
  process.env.STARTGG_SOURCE_URL ||
  "https://www.start.gg/tournament/basement-brawl-3-2/details";
const OUTFILE = resolve("public/events.json");

const token = process.env.STARTGG_TOKEN;

if (!token) {
  console.warn("STARTGG_TOKEN is not set. Keeping the existing events file.");
  process.exit(0);
}

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
    startAt: tournament.startAt ?? null,
    endAt: tournament.endAt ?? null,
    venueAddress: tournament.venueAddress || "",
    city: tournament.city || "Kitchener-Waterloo",
    region: tournament.addrState || "ON",
    countryCode: tournament.countryCode || "CA",
  },
  events,
};

await mkdir(dirname(OUTFILE), { recursive: true });
await writeFile(`${OUTFILE}.tmp`, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
await rename(`${OUTFILE}.tmp`, OUTFILE);

console.log(`Wrote ${OUTFILE} with ${events.length} event(s).`);
