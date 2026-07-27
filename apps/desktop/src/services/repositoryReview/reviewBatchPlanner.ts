import type {
  RepositoryInventory,
  RepositoryReviewRequest,
  ReviewBatchPlan
} from "@dbzs/shared";
import { estimateTokensCharHeuristic } from "@/runtime/context/contextSpooler";

const MIN_BATCH = 3;
const MAX_BATCH = 8;

type BucketId = "entry" | "domain" | "api" | "data" | "ui" | "audio" | "tests" | "perf";

interface Bucket {
  id: BucketId;
  title: string;
  purpose: string;
  domain: NonNullable<ReviewBatchPlan["domain"]>;
  priority: number;
  match: (path: string) => boolean;
}

const BUCKETS: Bucket[] = [
  {
    id: "entry",
    title: "Projektstruktur und Einstiegspunkte",
    purpose: "Entrypoints, Konfiguration, Abhängigkeiten und Projektregeln",
    domain: "build_dependencies",
    priority: 10,
    match: (path) =>
      /(^|\/)(main|index|app|package\.json|readme|agents|tsconfig|vite\.config|next\.config)/i.test(path)
  },
  {
    id: "domain",
    title: "Architektur und Datenfluss",
    purpose: "Stores, Services, Domain-Modelle, Zuständigkeiten und Datenfluss",
    domain: "architecture_dataflow",
    priority: 20,
    match: (path) => /(store|service|domain|model|state|hook)/i.test(path)
  },
  {
    id: "api",
    title: "Security, API und Backend",
    purpose: "Authentifizierung, Autorisierung, Endpunkte, Regeln und Eingabevalidierung",
    domain: "security_api",
    priority: 30,
    match: (path) => /(api|backend|auth|security|server|route|rules)/i.test(path)
  },
  {
    id: "data",
    title: "Persistenz und Datenkonsistenz",
    purpose: "Datenbanken, Storage, Schemas, Migrationen und Konsistenz",
    domain: "architecture_dataflow",
    priority: 40,
    match: (path) => /(db|database|schema|persist|storage|migration)/i.test(path)
  },
  {
    id: "ui",
    title: "UI-Komponenten und React-Lifecycle",
    purpose: "React State, Effects, Listener, Timer, Cleanup und UI-Flows",
    domain: "react_state",
    priority: 50,
    match: (path) => /(component|ui|view|page|tsx$)/i.test(path)
  },
  {
    id: "audio",
    title: "Audio, MIDI und Media-Ressourcen",
    purpose: "Audio-/Media-Pipelines, Ownership, Cleanup und Nebenläufigkeit",
    domain: "audio_media",
    priority: 60,
    match: (path) => /(audio|midi|media|sound|tone|webaudio)/i.test(path)
  },
  {
    id: "tests",
    title: "Tests und Observability",
    purpose: "Tests, CI, Diagnostik, Logging und Fehlertransparenz",
    domain: "tests_observability",
    priority: 70,
    match: (path) => /(test|spec|vitest|jest|ci|github\/workflows|log|diagnostic)/i.test(path)
  },
  {
    id: "perf",
    title: "Performance und Ressourcen",
    purpose: "Hot Paths, Worker, Cache, Speicher, I/O und Ressourcenlebenszyklen",
    domain: "performance_resources",
    priority: 80,
    match: (path) => /(perf|worker|cache|optimize|resource)/i.test(path)
  }
];

function chunkPaths(paths: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += size) {
    chunks.push(paths.slice(index, index + size));
  }
  if (chunks.length > 1 && (chunks.at(-1)?.length ?? 0) < MIN_BATCH) {
    const previous = chunks[chunks.length - 2]!;
    const tail = chunks[chunks.length - 1]!;
    while (tail.length < MIN_BATCH && previous.length > MIN_BATCH) {
      tail.unshift(previous.pop()!);
    }
  }
  return chunks;
}

function estimateBatchTokens(paths: string[]): number {
  return Math.max(256, paths.length * 800 + estimateTokensCharHeuristic(paths.join("\n")));
}

function sourceFiles(
  inventory: RepositoryInventory,
  request: RepositoryReviewRequest
): string[] {
  const preferredExt = /\.(ts|tsx|js|jsx|py|rs|go|java|cs|md|json)$/i;
  let files = inventory.files.filter((path) => preferredExt.test(path));
  const usesSelectedPaths = request.scope === "active_file" || request.scope === "selected_paths";
  if (usesSelectedPaths && request.selectedPaths?.length) {
    const selected = new Set(request.selectedPaths.map((path) => path.replace(/\\/g, "/")));
    files = files.filter((path) => selected.has(path));
  }
  const limit = request.depth === "quick" ? 40 : request.depth === "standard" ? 160 : 320;
  return files
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

export function planReviewBatches(
  request: RepositoryReviewRequest,
  inventory: RepositoryInventory
): ReviewBatchPlan[] {
  const files = sourceFiles(inventory, request);
  const assigned = new Set<string>();
  const batches: ReviewBatchPlan[] = [];
  let batchCounter = 0;

  const appendChunks = (
    paths: string[],
    config: Pick<Bucket, "title" | "purpose" | "domain" | "priority">
  ) => {
    const chunks = chunkPaths(paths, MAX_BATCH);
    chunks.forEach((chunk, index) => {
      if (chunk.length === 0) return;
      batchCounter += 1;
      batches.push({
        batchId: `batch-${batchCounter}`,
        title: chunks.length > 1 ? `${config.title} · ${index + 1}/${chunks.length}` : config.title,
        paths: chunk,
        purpose: config.purpose,
        domain: config.domain,
        estimatedTokens: estimateBatchTokens(chunk),
        priority: config.priority,
        splitDepth: 0,
        partIndex: index + 1,
        partCount: chunks.length
      });
    });
  };

  for (const bucket of BUCKETS) {
    const matched = files.filter((path) => !assigned.has(path) && bucket.match(path));
    matched.forEach((path) => assigned.add(path));
    appendChunks(matched, bucket);
  }

  appendChunks(
    files.filter((path) => !assigned.has(path)),
    {
      title: "Weitere Module",
      purpose: "Verbleibende Dateien im bestätigten Review-Scope",
      domain: "general",
      priority: 90
    }
  );

  if (batches.length === 0 && files.length > 0) {
    appendChunks(files.slice(0, MAX_BATCH), {
      title: "Projektstruktur und Einstiegspunkte",
      purpose: "Fallback-Batch",
      domain: "general",
      priority: 10
    });
  }

  return batches.sort((left, right) =>
    left.priority - right.priority || left.batchId.localeCompare(right.batchId)
  );
}

export function splitReviewBatch(batch: ReviewBatchPlan): ReviewBatchPlan[] {
  const nextDepth = (batch.splitDepth ?? 0) + 1;
  if (batch.paths.length <= 1 || nextDepth > 2) return [batch];

  const midpoint = Math.ceil(batch.paths.length / 2);
  const parts = [batch.paths.slice(0, midpoint), batch.paths.slice(midpoint)];
  const baseTitle = batch.title.replace(/\s+·\s+\d+\/\d+$/, "");
  return parts.map((paths, index) => ({
    ...batch,
    batchId: `${batch.batchId}-${index === 0 ? "a" : "b"}`,
    title: `${baseTitle} · ${index + 1}/2`,
    paths,
    estimatedTokens: estimateBatchTokens(paths),
    parentBatchId: batch.batchId,
    splitDepth: nextDepth,
    splitReason: "context_budget",
    partIndex: index + 1,
    partCount: 2
  }));
}
