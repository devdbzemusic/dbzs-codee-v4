/**
 * Redacts secret-shaped content before it's persisted to disk (JSONL boot
 * logs, bootDiagnosticExport.ts) -- both the diagnostics export and the log
 * file are meant to be shareable for troubleshooting, so neither may leak an
 * API key/token that happened to end up in an error message or stderr tail.
 */

const KEYWORD_PATTERN = /\b(API_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE|PRIVATE_KEY|BEARER)\s*[:=]\s*\S+/gi;

const VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi
];

const REDACTED = "[REDACTED]";

export function redactSecrets(input: string): string {
  let output = input.replace(KEYWORD_PATTERN, (match) => {
    const separatorIndex = Math.max(match.indexOf(":"), match.indexOf("="));
    const prefix = separatorIndex === -1 ? match : match.slice(0, separatorIndex + 1);
    return `${prefix} ${REDACTED}`;
  });
  for (const pattern of VALUE_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

/** Deep-redacts every string value in an arbitrary JSON-like structure (objects/arrays), leaving keys and non-string values untouched. */
export function redactSecretsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretsDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactSecretsDeep(val);
    }
    return result as unknown as T;
  }
  return value;
}
