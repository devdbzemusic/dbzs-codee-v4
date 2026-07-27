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

function extractPyModelKeys(file, modelName) {
  const raw = read(file);
  const start = raw.indexOf(`class ${modelName}(BaseModel):`);
  if (start < 0) return [];
  const tail = raw.slice(start);
  const nextClass = tail.slice(1).search(/\nclass\s+[A-Za-z_][A-Za-z0-9_]*\(BaseModel\):/);
  const block = nextClass > 0 ? tail.slice(0, nextClass + 1) : tail;
  return extractQuotedKeys(block);
}

function assertTsKeysPresentInPython(label, left, right) {
  const normalizedLeft = left.map(canonicalizeKey);
  const normalizedRight = right.map(canonicalizeKey);
  const leftOnly = normalizedLeft.filter((key) => !normalizedRight.includes(key));
  if (leftOnly.length) {
    throw new Error(`${label} mismatch. Missing in Python: [${leftOnly.join(", ")}]`);
  }
}

const residentTs = extractTsSchemaKeys("packages/shared/src/bootReadinessSchema.ts", "ResidentModelDataSchema");
const residentPy = extractPyModelKeys("backend/app/api/health_contracts.py", "ResidentModelDataModel");
assertTsKeysPresentInPython("ResidentModelData", residentTs, residentPy);

const warmupTs = extractTsSchemaKeys("packages/shared/src/runtimeWarmupDiagnosticsSchema.ts", "RuntimeWarmupDiagnosticsSchema");
const warmupPy = extractPyModelKeys("backend/app/runtime/schemas.py", "RuntimeWarmupDiagnostics");
assertTsKeysPresentInPython("RuntimeWarmupDiagnostics", warmupTs, warmupPy);

console.log("Runtime contract verification passed.");
