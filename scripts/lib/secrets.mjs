export const SECRET_ENV_NAMES = ["STARTGG_TOKEN", "YOUTUBE_API_KEY"];

const REDACTED = "[redacted]";

/** Values that must never reach stdout, stderr, a log file or a JSON output. */
export function collectSecretValues(env = {}, names = SECRET_ENV_NAMES) {
  const seen = new Set();

  for (const name of names) {
    const value = env?.[name];

    if (typeof value === "string" && value.length >= 4) seen.add(value);
  }

  return [...seen].sort((a, b) => b.length - a.length);
}

export function redactValues(text, values = []) {
  let output = String(text ?? "");

  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    output = output.split(value).join(REDACTED);
  }

  return output;
}

export function redactSecrets(text, env = {}, names = SECRET_ENV_NAMES) {
  return redactValues(text, collectSecretValues(env, names));
}
