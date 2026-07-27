/**
 * Minimal Codex apply_patch envelope parser (subset).
 * Parses *** Begin Patch / *** End Patch blocks with Update File hunks.
 */

export interface CodexPatchHunk {
  filePath: string;
  proposedContent?: string;
  patchText: string;
}

const PATCH_BLOCK = /\*\*\* Begin Patch\s*([\s\S]*?)\*\*\* End Patch/gi;

export function parseCodexPatchBlocks(content: string): CodexPatchHunk[] {
  const hunks: CodexPatchHunk[] = [];

  for (const match of content.matchAll(PATCH_BLOCK)) {
    const body = match[1] ?? "";
    const updateMatch = body.match(/\*\*\* Update File:\s*(.+?)\s*\n([\s\S]*)/i);
    if (updateMatch) {
      hunks.push({
        filePath: updateMatch[1].trim(),
        patchText: updateMatch[2].trim(),
        proposedContent: undefined
      });
    }

    const addMatch = body.match(/\*\*\* Add File:\s*(.+?)\s*\n([\s\S]*)/i);
    if (addMatch) {
      hunks.push({
        filePath: addMatch[1].trim(),
        patchText: addMatch[2].trim(),
        proposedContent: addMatch[2].trim()
      });
    }
  }

  return hunks;
}

export function looksLikeCodexPatch(content: string): boolean {
  return content.includes("*** Begin Patch") && content.includes("*** End Patch");
}
