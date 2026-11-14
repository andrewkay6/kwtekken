import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PUBLIC_DIR } from "../../scripts/lib/paths.mjs";

const nodeFs = { mkdir, readFile, rename, rm, writeFile };

export { nodeFs };

/** A real-filesystem module surface with chosen methods replaced. */
export function fakeFs(overrides = {}) {
  return { ...nodeFs, ...overrides };
}

export async function makeSandbox({ events, videos } = {}) {
  const root = await mkdtemp(join(tmpdir(), "kwtekken-sandbox-"));
  const publicDir = join(root, "public");

  await mkdir(publicDir, { recursive: true });

  const copy = async (name, contents) => {
    if (contents === null) return;

    const text =
      contents === undefined
        ? await readFile(join(PUBLIC_DIR, name), "utf8").catch(() => null)
        : typeof contents === "string"
          ? contents
          : `${JSON.stringify(contents, null, 2)}\n`;

    if (text !== null) await writeFile(join(publicDir, name), text, "utf8");
  };

  await copy("events.json", events);
  await copy("videos.json", videos);

  return {
    root,
    publicDir,
    eventsFile: join(publicDir, "events.json"),
    videosFile: join(publicDir, "videos.json"),
    read: async (name) => readFile(join(publicDir, name), "utf8"),
    readJson: async (name) => JSON.parse(await readFile(join(publicDir, name), "utf8")),
    exists: async (name) => {
      try {
        await readFile(join(publicDir, name));

        return true;
      } catch {
        return false;
      }
    },
    entries: async () => readdir(publicDir),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function fixedNow(iso = "2026-11-14T12:00:00.000Z") {
  const date = new Date(iso);

  return () => date;
}

export function unix(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function hoursFromNow(hours, from = "2026-11-14T12:00:00.000Z") {
  return unix(new Date(new Date(from).getTime() + hours * 3600 * 1000).toISOString());
}

/** Captures log/warn/error output so tests can assert on printed text. */
export function capture() {
  const lines = [];
  const push = (stream) => (message) => lines.push(`${stream}: ${message}`);

  return {
    lines,
    text: () => lines.join("\n"),
    loggers: { log: push("log"), warn: push("warn"), error: push("err") },
  };
}

export async function copyRepoPublicTo(dir) {
  await mkdir(dir, { recursive: true });

  for (const name of ["events.json", "videos.json"]) {
    await copyFile(join(PUBLIC_DIR, name), join(dir, name)).catch(() => {});
  }

  return dir;
}
