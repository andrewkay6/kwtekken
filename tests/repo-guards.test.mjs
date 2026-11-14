import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";

import { PROJECT_ROOT } from "../scripts/lib/paths.mjs";
import {
  EVENT_FEED_KEYS,
  SCENE_EVENT_KEYS,
  TOURNAMENT_KEYS,
  VIDEOS_KEYS,
  validateEventFeed,
  validateVideos,
} from "../scripts/lib/schema.mjs";

const FORBIDDEN_IN_CLIENT = ["STARTGG_TOKEN", "YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID", "STARTGG_PER_PAGE"];
const BROWSER_FILES = ["vite.config.ts", "index.html", "src/main.tsx", "src/App.tsx", "src/vite-env.d.ts", "src/styles.css"];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(ts|tsx|css|html|js|mjs|json)$/.test(entry.name)) files.push(path);
  }

  return files;
}

async function browserSources() {
  const files = [...BROWSER_FILES.map((path) => resolve(PROJECT_ROOT, path)), ...(await walk(resolve(PROJECT_ROOT, "src")))];

  return [...new Set(files)];
}

async function read(path) {
  return readFile(path, "utf8");
}

async function repoFile(path) {
  return read(resolve(PROJECT_ROOT, path));
}

describe("no credentials can reach the browser bundle", () => {
  it("src/, vite.config.ts and index.html mention no env access or secret names", async () => {
    const sources = await browserSources();

    assert.ok(sources.length >= 6, "expected to scan the client sources");

    for (const path of sources) {
      const text = await read(path);
      const label = relative(PROJECT_ROOT, path);

      assert.doesNotMatch(text, /import\.meta\.env/, `${label} must not read import.meta.env`);
      assert.doesNotMatch(text, /process\.env/, `${label} must not read process.env`);

      for (const name of FORBIDDEN_IN_CLIENT) {
        assert.doesNotMatch(text, new RegExp(name), `${label} must not mention ${name}`);
      }

      assert.doesNotMatch(text, /VITE_[A-Z0-9_]+/, `${label} must not define a VITE_ variable`);
    }
  });

  it("vite.config.ts exposes no env values to the client", async () => {
    const config = await repoFile("vite.config.ts");

    for (const forbidden of [/\bdefine\s*:/, /\benvPrefix\b/, /\benvDir\b/, /\bloadEnv\b/, /process\.env/]) {
      assert.doesNotMatch(config, forbidden, `vite.config.ts must not use ${forbidden}`);
    }
  });

  it("the app reads its data from the checked-in JSON at build time only", async () => {
    const app = await repoFile("src/App.tsx");

    assert.match(app, /import eventsJson from "\.\.\/public\/events\.json"/);
    assert.match(app, /import videosJson from "\.\.\/public\/videos\.json"/);
    assert.equal(app.includes("fetch("), false, "no runtime data fetch");
    assert.doesNotMatch(app, /STARTGG_URL|fallbackFeed|YOUTUBE_PLAYLIST_VIDEO_IDS/, "no hardcoded feed");
    assert.doesNotMatch(app, /basement.?brawl/i, "no stale tournament or playlist ids in the app");
  });
});

describe("checked-in data files", () => {
  it("public/events.json and public/videos.json are valid display data", async () => {
    const events = JSON.parse(await repoFile("public/events.json"));
    const videos = JSON.parse(await repoFile("public/videos.json"));

    assert.deepEqual(Object.keys(events), EVENT_FEED_KEYS);
    assert.deepEqual(validateEventFeed(events), []);
    assert.deepEqual(Object.keys(events.tournament).sort(), [...TOURNAMENT_KEYS].sort());

    for (const event of events.events) {
      assert.deepEqual(Object.keys(event).sort(), [...SCENE_EVENT_KEYS].sort());
    }

    assert.deepEqual(Object.keys(videos), VIDEOS_KEYS);
    assert.deepEqual(validateVideos(videos), []);
    assert.ok(videos.videoIds.length > 0, "the site must work without an API key");
  });

  it("neither data file contains a credential-shaped value", async () => {
    for (const name of ["public/events.json", "public/videos.json"]) {
      const text = await repoFile(name);

      for (const secret of FORBIDDEN_IN_CLIENT) assert.equal(text.includes(secret), false, `${name}: ${secret}`);

      assert.equal(/Bearer\s/.test(text), false, name);
      assert.equal(/"token"\s*:/.test(text), false, name);
      assert.equal(/-----BEGIN/.test(text), false, name);
    }
  });

  it("the allow-lists hold nothing but display keys", () => {
    const all = [...EVENT_FEED_KEYS, ...TOURNAMENT_KEYS, ...SCENE_EVENT_KEYS, ...VIDEOS_KEYS];

    for (const key of all) {
      assert.equal(/token|key|secret|password|authoriz|bearer|ownerId|email/i.test(key), false, key);
    }
  });
});

describe("local secret hygiene", () => {
  it("gitignores the dotenv files", async () => {
    const lines = (await repoFile(".gitignore"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    assert.ok(lines.includes(".env"), ".env must be gitignored");
    assert.ok(lines.includes(".env.local"), ".env.local must be gitignored");
  });

  it("ships an .env.example with the three keys and no values", async () => {
    const example = await repoFile(".env.example");
    const entries = Object.fromEntries(
      example
        .split(/\r?\n/)
        .filter((line) => /^[A-Z0-9_]+=/.test(line.trim()))
        .map((line) => [line.trim().split("=")[0], line.trim().slice(line.indexOf("=") + 1)]),
    );

    assert.deepEqual(Object.keys(entries).sort(), ["STARTGG_TOKEN", "YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"]);

    for (const [name, value] of Object.entries(entries)) assert.equal(value, "", `${name} must stay empty`);
  });

  it("keeps .env out of git's index", async () => {
    const tracked = spawnSync("git", ["ls-files"], { cwd: PROJECT_ROOT, encoding: "utf8" });

    if (tracked.status !== 0) return;

    const files = tracked.stdout.split(/\r?\n/).filter(Boolean);

    assert.deepEqual(
      files.filter((file) => file === ".env" || file === ".env.local" || file.endsWith("-secret.json")),
      [],
    );
  });
});

describe("npm scripts", () => {
  const scripts = JSON.parse("null") ?? null;

  it("wires the local update, live check and test commands", async () => {
    const pkg = JSON.parse(await repoFile("package.json"));

    assert.equal(pkg.scripts.test, "node --test");
    assert.match(pkg.scripts.update, /scripts\/update-all\.mjs/);
    assert.match(pkg.scripts["update:events"], /scripts\/update-events\.mjs/);
    assert.match(pkg.scripts["update:videos"], /scripts\/update-videos\.mjs/);
    assert.match(pkg.scripts["check:live"], /scripts\/live-check\.mjs/);

    for (const name of ["update", "update:events", "update:videos", "check:live"]) {
      assert.match(pkg.scripts[name], /--env-file-if-exists=\.env\b/, `${name} loads .env`);
      assert.match(pkg.scripts[name], /--env-file-if-exists=\.env\.local/, `${name} loads .env.local`);
      assert.equal(pkg.scripts[name].includes("dotenv"), false);
    }

    assert.equal(scripts, null);
  });

  it("adds no runtime or test dependencies for the automation", async () => {
    const pkg = JSON.parse(await repoFile("package.json"));

    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["lenis", "react", "react-dom"]);
    assert.deepEqual(
      Object.keys(pkg.devDependencies).sort(),
      ["@types/react", "@types/react-dom", "@vitejs/plugin-react", "react-refresh", "typescript", "vite"],
    );

    for (const forbidden of ["dotenv", "vitest", "jest", "mocha", "node-fetch", "axios", "googleapis", "gql-request"]) {
      assert.equal(JSON.stringify(pkg).toLowerCase().includes(forbidden), false, forbidden);
    }
  });
});

describe("deploy workflow stays build-only", () => {
  async function workflows() {
    const dir = resolve(PROJECT_ROOT, ".github/workflows");
    const entries = await readdir(dir);

    return Promise.all(
      entries.filter((name) => /\.(ya?ml)$/i.test(name)).map(async (name) => [name, await read(join(dir, name))]),
    );
  }

  it("contains no updater, secret or schedule reference", async () => {
    const files = await workflows();

    assert.ok(files.length >= 1);

    for (const [name, text] of files) {
      assert.doesNotMatch(text, /\$\{\{\s*secrets\./, `${name} must not read secrets`);
      assert.doesNotMatch(text, /^\s*secrets:/m, `${name} must not declare a job environment`);

      for (const secret of FORBIDDEN_IN_CLIENT) {
        assert.equal(text.includes(secret), false, `${name} must not mention ${secret}`);
      }

      assert.doesNotMatch(text, /^\s{2}schedule:/m, `${name} must not be scheduled`);
      assert.doesNotMatch(text, /cron:/, `${name} must not contain a cron expression`);
      assert.doesNotMatch(text, /run:\s*(?:npm|node|npx)\s+\S*(?:update|live-check|check:live)/, `${name} must not run an updater`);
      assert.doesNotMatch(text, /scripts\/(?:update|live-check)/, `${name} must not invoke the update scripts`);
      assert.doesNotMatch(text, /contents:\s*write/, `${name} must not gain write access to the repo`);
      assert.doesNotMatch(text, /git (commit|push)/, `${name} must not commit back`);
      assert.doesNotMatch(text, /github-actions\[bot\]/, name);
    }
  });

  it("still builds and deploys the Pages site", async () => {
    const text = await repoFile(".github/workflows/deploy.yml");

    assert.match(text, /^on:\n(?:.*\n)*?\s{2}push:/m, "keeps the push trigger");
    assert.match(text, /workflow_dispatch:/, "keeps manual runs");
    assert.match(text, /branches: \[main\]/);
    assert.match(text, /permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
    assert.match(text, /run: npm ci/);
    assert.match(text, /run: npm run build/);
    assert.match(text, /uses: actions\/checkout@v\d+/);
    assert.match(text, /uses: actions\/setup-node@v\d+/);
    assert.match(text, /uses: actions\/configure-pages@v?\d+/);
    assert.match(text, /uses: actions\/upload-pages-artifact@v?\d+/);
    assert.match(text, /uses: actions\/deploy-pages@v?\d+/);
    assert.match(text, /path: dist/);
    assert.match(text, /node-version: 2\d/);
  });
});

describe("every script is dependency-free Node", () => {
  const expected = [
    "scripts/live-check.mjs",
    "scripts/update-all.mjs",
    "scripts/update-events.mjs",
    "scripts/update-videos.mjs",
    "scripts/lib/cli.mjs",
    "scripts/lib/clock.mjs",
    "scripts/lib/io.mjs",
    "scripts/lib/paths.mjs",
    "scripts/lib/schema.mjs",
    "scripts/lib/secrets.mjs",
    "scripts/lib/startgg.mjs",
    "scripts/lib/summary.mjs",
    "scripts/lib/update-events.mjs",
    "scripts/lib/update-videos.mjs",
    "scripts/lib/youtube.mjs",
  ];

  it("passes node --check", () => {
    for (const file of expected) {
      const result = spawnSync(process.execPath, ["--check", resolve(PROJECT_ROOT, file)], { encoding: "utf8" });

      assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    }
  });

  it("lists exactly the scripts that exist", async () => {
    const found = (await walk(resolve(PROJECT_ROOT, "scripts"))).map((path) => relative(PROJECT_ROOT, path)).sort();

    assert.deepEqual(found, [...expected].sort());
  });

  it("imports nothing outside node: builtins and its own lib", async () => {
    const importLine = /^\s*(?:import|export)\b[^\n]*?\sfrom\s+"([^"]+)"\s*;?\s*$|^\s*\}\s*from\s+"([^"]+)"\s*;?\s*$/;

    for (const file of expected) {
      const text = await repoFile(file);

      for (const line of text.split("\n")) {
        const match = line.match(importLine);

        if (!match) continue;

        const specifier = match[1] ?? match[2];

        assert.match(
          specifier,
          /^node:|^\.{1,2}\//,
          `${file} imports ${specifier}; scripts must stay dependency-free`,
        );
      }
    }
  });
});
