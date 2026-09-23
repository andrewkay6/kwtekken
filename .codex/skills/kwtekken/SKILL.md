# KW Tekken Site Updates

Use this skill when updating the KW Tekken website, especially the featured start.gg tournament, event location, YouTube playlist, or event/photo content.

## Project Shape

- This is a Vite + React frontend-only site.
- The main UI lives in `src/App.tsx`.
- The checked-in start.gg fallback/cache lives in `public/events.json`.
- The start.gg refresh script is `scripts/update-events.mjs`.
- Build with `npm run build`.
- The browser should not call the start.gg API directly. Keep event data in `public/events.json`.

## Featured Event Updates

When the featured tournament changes, update all of these together:

- `src/App.tsx`
  - `STARTGG_URL`
  - `fallbackFeed.sourceUrl`
  - `fallbackFeed.tournament.name`
  - `fallbackFeed.tournament.slug`
  - `fallbackFeed.tournament.startAt`
  - `fallbackFeed.tournament.venueAddress`
  - `fallbackFeed.tournament.city`
  - `fallbackFeed.tournament.region`
- `public/events.json`
  - `sourceUrl`
  - `generatedAt`
  - `tournament.name`
  - `tournament.slug`
  - `tournament.startAt`
  - `tournament.venueAddress`
  - `tournament.city`
  - `tournament.region`
  - embed metadata if known
- `scripts/update-events.mjs`
  - hardcoded fallback `SOURCE_URL`
  - hardcoded fallback `TOURNAMENT_SLUG`

Use Unix epoch seconds for `startAt`. For KW events, use the local Ontario date boundary when the user only gives a date. Example: `2026-10-01T00:00:00-04:00` becomes `1790827200`.

If the user gives a new location, make sure `city` matches the actual municipality. Do not leave old Waterloo defaults when the address is in Kitchener.

## YouTube Playlist Updates

The homepage embeds the featured playlist in `src/App.tsx`.

- Update `YOUTUBE_PLAYLIST_ID`.
- Prefer the `videoseries` embed URL when only a playlist URL is provided:
  `https://www.youtube-nocookie.com/embed/videoseries?list=${YOUTUBE_PLAYLIST_ID}&rel=0&vq=hd1440&hd=1`
- Do not keep stale individual video IDs from an older playlist unless the user explicitly provides the new video IDs.
- If the embedded player says playback on other websites is disabled, do not work around it in code unless asked. The video owner needs to enable YouTube Studio's per-video `Allow embedding` setting for each public video in the playlist.

## start.gg Refresh Workflow

With a token:

```bash
STARTGG_TOKEN=your_token npm run update:events
```

For a different event, use:

```bash
STARTGG_SOURCE_URL=https://www.start.gg/tournament/example/details STARTGG_TOURNAMENT_SLUG=tournament/example npm run update:events
```

Without a token, the updater only refreshes embed metadata and preserves the checked-in fallback data.

The GitHub Pages deployment workflow runs `npm run update:events` before `npm run build`. With `STARTGG_TOKEN` set, CI can fetch start.gg data and affect the deployed artifact even though it does not commit `public/events.json`. Keep `scripts/update-events.mjs` preserving checked-in curated fields for the same featured tournament, especially `startAt`, `venueAddress`, `city`, and `region`, so the deploy pipeline does not revert manual date/location corrections.

## Verification

After edits, run:

```bash
npm run build
```

Check that the event card uses the new start.gg URL, date, city/address, and that the YouTube iframe uses the intended playlist ID.

## Local Tooling Note

On this machine, sandboxed PowerShell commands may fail before execution because of sandbox helper setup permissions. If that happens, rerun the same read-only or build command with escalation rather than broadening the search path.
