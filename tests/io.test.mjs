import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  hasMeaningfulChange,
  projectKeys,
  readJsonFile,
  stableStringify,
  writeJsonAtomic,
} from "../scripts/lib/io.mjs";
import { fakeFs, nodeFs } from "./helpers/sandbox.mjs";

const dirs = [];

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "kwtekken-io-"));

  dirs.push(dir);

  return dir;
}

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function exists(path) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

describe("hasMeaningfulChange", () => {
  const feed = (overrides = {}) => ({
    sourceUrl: "https://www.start.gg/tournament/a/details",
    generatedAt: "2026-01-01T00:00:00.000Z",
    tournament: { name: "A", slug: "tournament/a", startAt: 1 },
    events: [{ id: 1, name: "Open" }],
    ...overrides,
  });

  it("treats a generatedAt-only difference as no change", () => {
    assert.equal(hasMeaningfulChange(feed(), feed({ generatedAt: "2026-11-11T11:11:11.000Z" })), false);
  });

  it("treats identical data as no change", () => {
    assert.equal(hasMeaningfulChange(feed(), feed()), false);
  });

  it("detects a real change in nested data", () => {
    assert.equal(
      hasMeaningfulChange(feed(), feed({ tournament: { name: "B", slug: "tournament/a", startAt: 1 } })),
      true,
    );
    assert.equal(hasMeaningfulChange(feed(), feed({ events: [] })), true);
  });

  it("ignores key order but not array order", () => {
    assert.equal(hasMeaningfulChange({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
    assert.equal(hasMeaningfulChange({ ids: ["a", "b"] }, { ids: ["b", "a"] }), true);
  });

  it("accepts raw JSON text and reports a missing side as a change", () => {
    assert.equal(hasMeaningfulChange(JSON.stringify(feed()), feed({ generatedAt: "later" })), false);
    assert.equal(hasMeaningfulChange(null, feed()), true);
    assert.equal(hasMeaningfulChange(feed(), null), true);
    assert.equal(hasMeaningfulChange("{ not json", feed()), true);
  });

  it("can ignore extra volatile keys", () => {
    const before = { generatedAt: "x", fetchedAt: "y", value: 1 };
    const after = { generatedAt: "x2", fetchedAt: "y2", value: 1 };

    assert.equal(hasMeaningfulChange(before, after, { volatileKeys: ["generatedAt", "fetchedAt"] }), false);
    assert.equal(hasMeaningfulChange(before, after), true);
  });
});

describe("stableStringify", () => {
  it("sorts object keys and keeps array order", () => {
    assert.equal(stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] }), stableStringify({ a: [2, { c: 3, d: 4 }], b: 1 }));
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  });
});

describe("projectKeys", () => {
  it("keeps only allow-listed keys and reports what it dropped", () => {
    const { value, dropped } = projectKeys({ keep: 1, token: "secret", other: 2 }, ["keep", "other"]);

    assert.deepEqual(value, { keep: 1, other: 2 });
    assert.deepEqual(dropped, ["token"]);
  });

  it("omits absent keys instead of inventing them", () => {
    assert.deepEqual(projectKeys({}, ["a", "b"]).value, {});
    assert.deepEqual(projectKeys(null, ["a"]).value, {});
  });
});

describe("readJsonFile", () => {
  it("reports a missing file without an error", async () => {
    const dir = await tempDir();
    const result = await readJsonFile(join(dir, "nope.json"));

    assert.deepEqual(result, { raw: null, data: null, error: null });
  });

  it("returns the parse error for invalid JSON", async () => {
    const dir = await tempDir();
    const file = join(dir, "bad.json");

    await writeFile(file, "{ nope", "utf8");

    const result = await readJsonFile(file);

    assert.equal(result.data, null);
    assert.ok(result.error instanceof Error);
    assert.equal(result.raw, "{ nope");
  });

  it("returns parsed data for a good file", async () => {
    const dir = await tempDir();
    const file = join(dir, "good.json");

    await writeFile(file, '{"a":1}', "utf8");

    assert.deepEqual(await readJsonFile(file), { raw: '{"a":1}', data: { a: 1 }, error: null });
  });
});

describe("writeJsonAtomic", () => {
  it("writes the file and leaves no temp file behind", async () => {
    const dir = await tempDir();
    const file = join(dir, "out.json");

    await writeJsonAtomic(file, { a: 1 });

    assert.equal(await readFile(file, "utf8"), '{\n  "a": 1\n}\n');
    assert.equal(await exists(`${file}.tmp`), false);
  });

  it("creates missing parent directories", async () => {
    const dir = await tempDir();
    const file = join(dir, "nested", "deeper", "out.json");

    await writeJsonAtomic(file, { a: 1 });

    assert.match(await readFile(file, "utf8"), /"a": 1/);
  });

  it("leaves the existing file untouched and cleans up when the rename fails", async () => {
    const dir = await tempDir();
    const file = join(dir, "out.json");

    await writeFile(file, "ORIGINAL\n", "utf8");

    const error = await writeJsonAtomic(
      file,
      { a: 2 },
      { fs: fakeFs({ rename: async () => { throw new Error("EPERM rename"); } }) },
    ).catch((caught) => caught);

    assert.ok(error instanceof Error);
    assert.match(error.message, /EPERM/);
    assert.equal(await readFile(file, "utf8"), "ORIGINAL\n");
    assert.equal(await exists(`${file}.tmp`), false, "temp file cleaned up");
  });

  it("does not touch the filesystem at all when the value cannot be serialised", async () => {
    const dir = await tempDir();
    const file = join(dir, "missing.json");
    const circular = { a: 1 };

    circular.self = circular;

    let touched = false;
    const fs = fakeFs({
      mkdir: async () => {
        touched = true;
      },
    });

    await assert.rejects(() => writeJsonAtomic(file, circular, { fs }), TypeError);
    assert.equal(touched, false);
    assert.equal(await exists(file), false);
  });

  it("cleans up when the temp write fails", async () => {
    const dir = await tempDir();
    const file = join(dir, "out.json");
    let removed = false;
    const fs = {
      ...nodeFs,
      writeFile: async () => {
        throw new Error("ENOSPC");
      },
      rm: async (path, options) => {
        removed = true;

        return rm(path, options);
      },
    };

    await assert.rejects(() => writeJsonAtomic(file, { a: 1 }, { fs }), /ENOSPC/);
    assert.equal(removed, true);
    assert.equal(await exists(file), false);
  });

  it("is used with a real directory tree", async () => {
    const dir = await tempDir();

    await mkdir(join(dir, "seed"), { recursive: true });
    assert.equal(await exists(join(dir, "seed")), true);
  });
});
