# KW Tekken

Frontend-only React site for `kwtekken.ca`, built with Vite and deployed to GitHub Pages.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## start.gg events

The browser should not call the start.gg API directly because the API requires a bearer token. Instead, this repo keeps a static cache at `public/events.json`.

To refresh it locally:

```bash
STARTGG_TOKEN=your_token npm run update:events
```

For GitHub Pages, add a repository secret named `STARTGG_TOKEN`. The deploy workflow will refresh `public/events.json` before building. If no token is present, the workflow keeps the checked-in fallback event file and the site still builds.

The updater has checked-in defaults for the currently featured tournament. Override them only when refreshing a different event:

- `STARTGG_TOURNAMENT_SLUG`
- `STARTGG_SOURCE_URL`

## Deployment

The workflow at `.github/workflows/deploy.yml` deploys `dist` to GitHub Pages on pushes to `main`. The custom domain is configured by `public/CNAME`.

In the GitHub repo settings, enable Pages with GitHub Actions as the source, then point the `kwtekken.ca` DNS records at GitHub Pages.
