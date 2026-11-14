import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const nodeFs = { mkdir, readFile, rename, rm, writeFile };

export const VOLATILE_KEYS = ["generatedAt"];

/**
 * Reads and parses JSON. A missing file is not an error (data: null,
 * error: null); unreadable or invalid JSON reports the error but never throws.
 */
export async function readJsonFile(filePath, { fs = nodeFs } = {}) {
  let raw;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { raw: null, data: null, error: null };
    return { raw: null, data: null, error };
  }

  try {
    return { raw, data: JSON.parse(raw), error: null };
  } catch (error) {
    return { raw, data: null, error };
  }
}

/**
 * Serialises first, then writes to a sibling .tmp file and renames into place,
 * so a failed run can never leave a half-written feed behind. The temp file is
 * removed if anything goes wrong.
 */
export async function writeJsonAtomic(filePath, value, { fs = nodeFs } = {}) {
  const target = resolve(filePath);
  const tmpPath = `${target}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;

  await fs.mkdir(dirname(target), { recursive: true });

  try {
    await fs.writeFile(tmpPath, text, "utf8");
    await fs.rename(tmpPath, target);
  } catch (error) {
    if (typeof fs.rm === "function") {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }

    throw error;
  }

  return { target, text };
}

function parseMaybe(value) {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stripVolatile(value, keys) {
  if (Array.isArray(value)) return value.map((entry) => stripVolatile(entry, keys));

  if (!value || typeof value !== "object") return value;

  const result = {};

  for (const [key, entry] of Object.entries(value)) {
    if (keys.includes(key)) continue;
    result[key] = stripVolatile(entry, keys);
  }

  return result;
}

/** Deterministic JSON: object keys sorted, array order preserved. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  if (value === undefined) return "null";

  return JSON.stringify(value);
}

function canonical(value, volatileKeys) {
  const parsed = parseMaybe(value);

  if (parsed === undefined) return "\u0000unparseable";
  if (parsed === null) return "null";

  return stableStringify(stripVolatile(parsed, volatileKeys));
}

/**
 * Compares two feeds ignoring volatile bookkeeping fields such as
 * generatedAt, so a refresh that changed nothing real is reported as
 * "no change".
 */
export function hasMeaningfulChange(before, after, { volatileKeys = VOLATILE_KEYS } = {}) {
  return canonical(before, volatileKeys) !== canonical(after, volatileKeys);
}

/**
 * Keeps only allow-listed keys so generated files can never carry anything but
 * display data (a token or key sitting in an input object is dropped here).
 */
export function projectKeys(value, keys) {
  const source = value && typeof value === "object" ? value : {};
  const dropped = Object.keys(source)
    .filter((key) => !keys.includes(key))
    .sort();
  const result = {};

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  }

  return { value: result, dropped };
}
