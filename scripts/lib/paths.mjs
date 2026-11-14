import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(libDir, "..", "..");
export const PUBLIC_DIR = resolve(PROJECT_ROOT, "public");
export const EVENTS_OUT_FILE = resolve(PUBLIC_DIR, "events.json");
export const VIDEOS_OUT_FILE = resolve(PUBLIC_DIR, "videos.json");
