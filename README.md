# KW Tekken

Frontend-only React site for `kwtekken.ca`, built with Vite and deployed to GitHub Pages.

## Local development

Requires Node.js 22 or newer (the update scripts use the global `fetch`).

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Site data: events and the VOD playlist

The homepage features the next start.gg tournament and a random video from the
newest Basement Brawl playlist. Both come from two checked-in files that are
bundled at build time:

- `public/events.json` — featured tournament, its brackets and the start.gg link preview.
- `public/videos.json` — the newest event playlist and its public video ids.

Nothing refreshes in the browser. The data changes only when the files are
regenerated locally and the site is redeployed, which keeps the API credentials
entirely out of the deployed bundle.

### Updating the data locally

```bash
cp .env.example .env   # then fill in STARTGG_TOKEN and YOUTUBE_API_KEY
npm run update         # runs both updaters, then prints a summary
git diff               # review what changed
git commit -am "Automated event/playlist update" && git push
```

`npm run update` loads `.env` and `.env.local` with Node's built-in
`--env-file-if-exists`, so there is no dotenv dependency. It prints the selected
tournament, its date, the playlist title, the video count and whether each file
actually changed (`generatedAt`-only differences do not count). It never
commits or pushes: that stays with you.

Run one updater at a time with `npm run update:events` or
`npm run update:videos`. Both accept `--dry-run` (report only) and
`--out <file>` (write somewhere else), plus `--help`.

What each updater does:

- **events** — with `STARTGG_TOKEN`, queries `currentUser`, then
  `tournaments(query: { filter: { ownerId }, sortBy: "startAt desc" })` page by
  page, and features the soonest tournament that starts no earlier than 12 hours
  ago, so an event stays featured on the day it runs. If nothing qualifies it
  falls back to the most recent past tournament, then fetches that tournament's
  details and brackets. When the slug has not changed it keeps the checked-in
  `startAt`, `venueAddress`, `city` and `region`, because start.gg sometimes
  leaves those blank for a local event. The `og:` preview metadata is fetched
  separately: if that one request fails, the previous embed fields are kept with
  a warning. Without a token the current feed is kept and only the embed
  metadata is refreshed.
- **videos** — resolves the channel (from `YOUTUBE_CHANNEL_ID`, otherwise the
  `@KWTekken` handle), lists its playlists, picks the highest `#N` event playlist
  that still holds items, lists that playlist and keeps only public,
  non-deleted videos. Without a key the checked-in file is kept.

Failure rules for both: on any API problem (HTTP error, GraphQL `errors`,
`currentUser` returning nothing, an empty tournament list, a playlist with no
usable videos) the script prints a clear error and exits non-zero, leaving the
existing JSON untouched, so a bad run can never overwrite good data with a
partial or empty feed. Writes are atomic (temp file plus rename) and every key
that is not display data is dropped before writing.

### Overrides

| Variable | Purpose |
| --- | --- |
| `STARTGG_TOKEN` | start.gg personal access token. Enables tournament discovery. |
| `STARTGG_TOURNAMENT_SLUG` | Feature this slug and skip discovery (e.g. `tournament/basement-brawl-11`). |
| `STARTGG_SOURCE_URL` | Same, given a full start.gg URL. Wins over the slug. |
| `STARTGG_GRACE_HOURS` | How long an event may have started and still count as featured. Default `12`. |
| `STARTGG_PER_PAGE`, `STARTGG_MAX_PAGES` | Discovery pagination. Defaults `25` and `5`. |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key (an API key, not OAuth). |
| `YOUTUBE_CHANNEL_ID` | Skip the `@KWTekken` handle lookup. |
| `YOUTUBE_CHANNEL_HANDLE` | Handle to resolve when no id is set. Default `KWTekken`. |
| `YOUTUBE_PLAYLIST_ID` | Force this playlist and skip playlist discovery. |
| `YOUTUBE_MAX_RESULTS` | Page size for playlist listing. Default `50`. |

## Secrets

The start.gg token and the YouTube API key exist only in your local, gitignored
`.env`; no credentials are stored in GitHub and CI never sees them. They are
deliberately not named with a `VITE_` prefix, nothing under `src/` reads
`import.meta.env` or `process.env`, and `vite.config.ts` sets no `define`,
`envPrefix` or `envDir`, so they cannot reach the browser bundle — the site
serves only the derived JSON. `.env` and `.env.local` are gitignored and
`.env.example` documents the shape. `npm test` guards all of this: it scans
`src/`, `vite.config.ts` and `index.html` for the secret names, and checks that
the writers emit only allow-listed keys.

## Live verification

`npm run check:live` runs both updaters against the real APIs using the keys in
your environment, but writes only into a throwaway temp directory — `public/` is
never touched, and neither API is sent anything but read queries.

```bash
npm run check:live
```

Expected output:

```text
Live check (scratch dir: /tmp/kwtekken-live-check-XXXX)
  start.gg: Basement Brawl 11: T7 Edition — 2026-12-05
           slug tournament/basement-brawl-11-t7-edition (upcoming)
           url  https://www.start.gg/tournament/basement-brawl-11-t7-edition/details
           3 event(s) in events.json
  YouTube: "Basement Brawl #11" (PLxxxxxxxx)
           12 public video(s) from channel
  events.json schema: OK (sourceUrl, generatedAt, tournament, events)
  videos.json schema: OK (generatedAt, playlistId, playlistTitle, videoIds)
Live check passed. Only the checked-in public/ data would have to be regenerated.
```

It exits non-zero and lists the problems if a key is missing, an API call fails,
a generated file is missing, invalid, or fails its schema check. Confirm the
tournament named is really your next event, that the playlist is the newest
`Basement Brawl #N`, and that the video count excludes anything private — if a
private video shows up in `videos.json`, stop and fix the key's scope before
committing. The token and key are redacted from every line it prints, so the
output is safe to paste into a bug report.

## Tests

```bash
npm test          # or: node --test
```

Uses Node's built-in test runner only; there are no test dependencies and no
network access — every API interaction runs against fake `fetch` implementations.

## Deployment

`.github/workflows/deploy.yml` runs `npm ci`, `npm run build` and deploys `dist`
to GitHub Pages on pushes to `main`, or from a manual **Run workflow**. It builds
from the checked-in JSON only, and contains no updaters, no schedule and no
secrets. The custom domain is configured by `public/CNAME`.

In the GitHub repo settings, enable Pages with GitHub Actions as the source, then
point the `kwtekken.ca` DNS records at GitHub Pages.

Because refreshes are local by design, the featured event goes stale whenever
nobody has run `npm run update` and pushed — worth a monthly habit. (That is also
why there is no scheduled workflow: GitHub silently disables schedules on repos
with no activity for 60 days, and a half-working cron would be worse than none.)
