import type { WorkspaceProjectFile } from "@dbzs/shared";

export interface ContextMention {
  type: "file" | "folder";
  path: string;
  label: string;
}

const MENTION_PATTERN = /@(file|folder):([^\s@]+)/gi;

export function parseContextMentions(text: string): ContextMention[] {
  const mentions: ContextMention[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const type = match[1] as "file" | "folder";
    const path = match[2]?.trim();
    if (!path) {
      continue;
    }
    mentions.push({ type, path, label: path });
  }
  return mentions;
}

export function buildMentionContextBlock(
  mentions: ContextMention[],
  workspaceFiles: WorkspaceProjectFile[]
): string | null {
  if (mentions.length === 0) {
    return null;
  }

  const lines = ["[Context Mentions]", ...mentions.map((m) => `- @${m.type}:${m.path}`)];

  for (const mention of mentions) {
    if (mention.type === "file") {
      const file = workspaceFiles.find(
        (f) =>
          f.relativePath === mention.path ||
          f.path.replace(/\\/g, "/").endsWith(mention.path.replace(/\\/g, "/"))
      );
      if (file) {
        const content = (file as { content?: string }).content ?? "";
        lines.push(`\n### ${mention.path}`, content.slice(0, 8000));
      }
    } else {
      const prefix = mention.path.replace(/\\/g, "/").replace(/\/$/, "");
      const children = workspaceFiles
        .filter((f) => f.relativePath.startsWith(prefix))
        .slice(0, 30)
        .map((f) => `- ${f.relativePath}`);
      lines.push(`\n### Folder ${mention.path}`, children.join("\n") || "- (leer)");
    }
  }

  return lines.join("\n");
}

export function suggestMentionPaths(
  query: string,
  workspaceFiles: WorkspaceProjectFile[],
  limit = 12
): ContextMention[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const fileMatches = workspaceFiles
    .filter((f) => f.relativePath.toLowerCase().includes(normalized))
    .slice(0, limit)
    .map((f) => ({
      type: "file" as const,
      path: f.relativePath,
      label: f.relativePath
    }));

  const folderSet = new Set<string>();
  for (const file of workspaceFiles) {
    const parts = file.relativePath.split("/");
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folder = parts.slice(0, i + 1).join("/");
      if (folder.toLowerCase().includes(normalized)) {
        folderSet.add(folder);
      }
    }
  }

  const folderMatches = [...folderSet]
    .slice(0, limit)
    .map((path) => ({
      type: "folder" as const,
      path,
      label: path
    }));

  return [...folderMatches, ...fileMatches].slice(0, limit);
}

export function insertMention(draft: string, mention: ContextMention): string {
  const token = `@${mention.type}:${mention.path}`;
  const trimmed = draft.trimEnd();
  return trimmed.length > 0 ? `${trimmed} ${token} ` : `${token} `;
}
