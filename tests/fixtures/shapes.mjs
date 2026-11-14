export const EMBED_HTML = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Basement Brawl #11 (T7 EDITION)" />
    <meta name="og:description" content="The best place for Basement Brawl #11 brackets &amp; streams &#x27;all in one&#x27;." />
    <meta property="og:image" content="https://images.start.gg/images/tournament/999/image.png" />
  </head>
  <body>hi</body>
</html>`;

export function ownedTournament({ id = 900, slug = "tournament/basement-brawl-11", startAt = null, name = null } = {}) {
  return {
    id,
    name: name ?? slug.replace("tournament/", "").replace(/-/g, " "),
    slug,
    startAt,
    endAt: null,
    venueAddress: "17 Benton St",
    city: "Kitchener",
    addrState: "ON",
    countryCode: "CA",
  };
}

export function tournamentDetails({
  id = 900,
  name = "Basement Brawl 11: T7 Edition",
  slug = "tournament/basement-brawl-11",
  startAt = 1797000000,
  endAt = null,
  venueAddress = "17 Benton St, Kitchener, ON N2G 1V8, Canada",
  city = "Kitchener",
  addrState = "ON",
  countryCode = "CA",
  events = [
    { id: 5001, name: "Tekken 8 - Open Bracket", slug: `${slug}/tekken-8-open`, startAt, numEntrants: 32, videogame: { name: "Tekken 8" } },
    { id: 5002, name: "Tekken 8 - Doubles", slug: `${slug}/tekken-8-doubles`, startAt: null, numEntrants: null, videogame: null },
  ],
} = {}) {
  return { id, name, slug, startAt, endAt, venueAddress, city, addrState, countryCode, events };
}

export function previousFeed(overrides = {}) {
  return {
    sourceUrl: "https://www.start.gg/tournament/basement-brawl-10-caf-edition/details",
    generatedAt: "2026-10-29T16:16:55.587Z",
    tournament: {
      name: "Basement Brawl 10: CAFÉ Edition",
      slug: "tournament/basement-brawl-10-caf-edition",
      startAt: 1793921400,
      endAt: null,
      venueAddress: "17 Benton St, Kitchener, ON N2G 1V8, Canada",
      city: "Kitchener",
      region: "ON",
      countryCode: "CA",
      embedTitle: "Basement Brawl #10 (CAFÉ EDITION)",
      embedDescription: "Old description",
      embedImageUrl: "https://images.start.gg/images/tournament/969660/old.png",
    },
    events: [],
    ...overrides,
  };
}

export function playlist(id, title, itemCount = 3, publishedAt = "2026-01-01T00:00:00Z") {
  return { id, snippet: { title, publishedAt }, contentDetails: { itemCount } };
}

export function playlistItem(videoId, title = `VOD ${videoId}`, privacy = "public") {
  const item = { snippet: { title } };

  if (videoId) item.contentDetails = { videoId };
  if (privacy) item.status = { privacyStatus: privacy };

  return item;
}

export function videoIds(count, prefix = "vid") {
  return Array.from({ length: count }, (_value, index) => `${prefix}${index}`);
}
