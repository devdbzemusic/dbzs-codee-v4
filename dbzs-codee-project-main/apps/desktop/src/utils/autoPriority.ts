const HIGH_KEYWORDS = [
  "kritisch", "bug", "crash", "hotfix", "urgent", "dringend", "asap",
  "production", "prod", "fehler", "absturz", "critical", "blocker", "security",
];
const LOW_KEYWORDS = [
  "review", "refactor", "cleanup", "docs", "documentation", "test",
  "chore", "style", "format", "optimierung", "improvement", "nice-to-have",
];

export function autoPriority(title: string, prompt = ""): number {
  const combined = `${title} ${prompt}`.toLowerCase();
  if (HIGH_KEYWORDS.some((kw) => combined.includes(kw))) return 9;
  if (LOW_KEYWORDS.some((kw) => combined.includes(kw))) return 2;
  return 5;
}
