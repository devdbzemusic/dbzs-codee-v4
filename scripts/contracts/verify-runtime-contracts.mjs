import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function camelToSnake(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function canonicalizeKey(value) {
  return camelToSnake(value).replace(/_/g, "");
}

function extractQuotedKeys(block) {
  const matches = [...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/gm)];
  return matches.map((match) => match[1]);
}

function extractTsSchemaKeys(file, schemaName) {
  const raw = read(file);
  const start = raw.indexOf(`export const ${schemaName} = z.object({`);
  if (start < 0) return [];
  const tail = raw.slice(start);
  const end = tail.indexOf("});");
  const block = tail.slice(0, end);
  return extractQuotedKeys(block);
}

function extractPyModelKeys(file, modelName, seen = new Set()) {
  if (seen.has(modelName)) return [];
  seen.add(modelName);

  const raw = read(file);
  const classHeaderPattern = new RegExp(`class ${modelName}\\(([A-Za-z_][A-Za-z0-9_]*)\\):`);
  const headerMatch = raw.match(classHeaderPattern);
  if (!headerMatch) return [];

  const start = headerMatch.index;
  const tail = raw.slice(start);
  const nextClass = tail.slice(1).search(/\nclass\s+[A-Za-z_][A-Za-z0-9_]*\([A-Za-z_][A-Za-z0-9_]*\):/);
  const block = nextClass > 0 ? tail.slice(0, nextClass + 1) : tail;
  const ownKeys = extractQuotedKeys(block);

  const baseClass = headerMatch[1];
  const inheritedKeys = baseClass === "BaseModel" ? [] : extractPyModelKeys(file, baseClass, seen);
  return [...inheritedKeys, ...ownKeys];
}

function extractCsDtoKeys(file, className) {
  const raw = read(file);
  const start = raw.indexOf(`class ${className}`);
  if (start < 0) return [];
  const tail = raw.slice(start);
  const nextClass = tail.slice(1).search(/\n(?:public\s+)?(?:sealed\s+)?class\s+[A-Za-z_][A-Za-z0-9_]*/);
  const block = nextClass > 0 ? tail.slice(0, nextClass + 1) : tail;
  return [...block.matchAll(/\[JsonPropertyName\("([^"]+)"\)\]/g)].map((match) => match[1]);
}

function assertKeysSubsetOfPython(label, left, right) {
  const normalizedLeft = left.map(canonicalizeKey);
  const normalizedRight = right.map(canonicalizeKey);
  const leftOnly = normalizedLeft.filter((key) => !normalizedRight.includes(key));
  if (leftOnly.length) {
    throw new Error(`${label} mismatch. Missing in Python: [${leftOnly.join(", ")}]`);
  }
}

const residentTs = extractTsSchemaKeys("packages/shared/src/bootReadinessSchema.ts", "ResidentModelDataSchema");
const residentPy = extractPyModelKeys("backend/app/api/health_contracts.py", "ResidentModelDataModel");
assertKeysSubsetOfPython("ResidentModelData", residentTs, residentPy);

const warmupTs = extractTsSchemaKeys("packages/shared/src/runtimeWarmupDiagnosticsSchema.ts", "RuntimeWarmupDiagnosticsSchema");
const warmupPy = extractPyModelKeys("backend/app/runtime/schemas.py", "RuntimeWarmupDiagnostics");
assertKeysSubsetOfPython("RuntimeWarmupDiagnostics", warmupTs, warmupPy);

// WinUI C# DTOs (apps/model-ops-winui/) are a third consumer of the model-lab backend
// contract, alongside TS and Python. They deliberately only read a subset of each
// backend model's fields, so this checks (like the TS checks above) that every field
// the DTO actually reads still exists on the backend model -- not full symmetry.
const MODEL_LAB_DTO_FILE = "apps/model-ops-winui/Contracts/ModelLabDtos.cs";
const MODEL_LAB_MODELS_FILE = "backend/app/model_lab/models.py";
const modelLabDtoPairs = [
  ["ModelSourceDto", "ModelSource"],
  ["ModelBundleDto", "ModelBundle"],
  ["ModelHealthDto", "ModelHealth"],
  ["ModelArtifactDto", "ModelArtifact"],
  ["ModelMetadataUpdateDto", "ModelMetadataUpdate"],
  ["ModelCollectionDto", "ModelCollection"],
  ["ScanJobDto", "ScanJob"],
  ["HardwareProfileDto", "HardwareProfile"]
];
for (const [dtoName, pyModelName] of modelLabDtoPairs) {
  const csKeys = extractCsDtoKeys(MODEL_LAB_DTO_FILE, dtoName);
  const pyKeys = extractPyModelKeys(MODEL_LAB_MODELS_FILE, pyModelName);
  if (csKeys.length === 0 || pyKeys.length === 0) {
    throw new Error(`Model Lab contract check could not read fields for ${dtoName}/${pyModelName} -- schema likely renamed.`);
  }
  assertKeysSubsetOfPython(`ModelLab ${dtoName}`, csKeys, pyKeys);
}

console.log("Runtime contract verification passed.");
