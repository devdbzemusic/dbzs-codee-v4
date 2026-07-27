"""DBZS – Repository-RAG Kernservice.

Zweck: Inkrementelle, sichere Workspace-Indexierung und Hybrid Retrieval.
Input: Workspace-Pfade, geänderte Dateien, Retrieval Queries und Embeddings.
Output: SQLite-Index, Retrieval Manifeste, Source References und lokale Metriken.
Eltern: FastAPI RAG Router. Kinder: SQLite/FTS5, Python-AST und Dateisystem.
Hinweise: Secret-/Binary-Dateien werden ausgeschlossen; lexikalisches Retrieval
bleibt ohne Embedding-Modell vollständig funktionsfähig.
"""

from __future__ import annotations

import ast
import fnmatch
import hashlib
import json
import logging
import math
import re
import sqlite3
import struct
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from app.core.config import get_app_data_dir
from app.core.context_policy import is_context_path_allowed
from app.rag.models import RetrievalQuery

IGNORED_DIRS = {".venv", "__pycache__", ".pytest_cache"}
SECRET_NAMES = {".env", ".env.local", ".env.production", ".npmrc", ".pypirc", "credentials.json"}
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".zip", ".exe", ".dll", ".so", ".dylib", ".woff", ".woff2", ".pdf", ".db", ".sqlite"}
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".md", ".json", ".yaml", ".yml", ".toml", ".ini", ".txt", ".css", ".scss", ".html"}
SYMBOL_RE = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(class|function|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)
METHOD_RE = re.compile(r"^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^={]+)?\{", re.MULTILINE)
IMPORT_RE = re.compile(r"(?:from\s+['\"]([^'\"]+)['\"]|from\s+([\w.]+)\s+import|require\(['\"]([^'\"]+)['\"]\))")
EXPORT_RE = re.compile(r"^\s*export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)", re.MULTILINE)
logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def workspace_id(root: Path) -> str:
    return hashlib.sha256(str(root.resolve()).lower().encode("utf-8")).hexdigest()[:24]


def estimate_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4))


@dataclass
class Chunk:
    symbol: str | None
    kind: str | None
    start: int
    end: int
    content: str


class RagService:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or get_app_data_dir() / "rag.sqlite3"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, dict] = {}
        self._workspace_locks: dict[str, threading.Lock] = {}
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, root TEXT UNIQUE NOT NULL, last_indexed_at TEXT, duration_ms INTEGER, error TEXT);
            CREATE TABLE IF NOT EXISTS workspace_files(workspace_id TEXT NOT NULL, path TEXT NOT NULL, content_hash TEXT NOT NULL, language TEXT, indexed_at TEXT NOT NULL, PRIMARY KEY(workspace_id,path), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS workspace_index(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_type TEXT NOT NULL, file_path TEXT NOT NULL, language TEXT, symbol_name TEXT, symbol_kind TEXT, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL, token_count INTEGER NOT NULL, imports_json TEXT NOT NULL, exports_json TEXT NOT NULL, indexed_at TEXT NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_workspace_index_path ON workspace_index(workspace_id,file_path);
            CREATE INDEX IF NOT EXISTS idx_workspace_index_symbol ON workspace_index(workspace_id,symbol_name);
            CREATE TABLE IF NOT EXISTS embedding_cache(source_id TEXT NOT NULL, content_hash TEXT NOT NULL, embedding_model_id TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL, token_count INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(source_id,content_hash,embedding_model_id));
            CREATE TABLE IF NOT EXISTS retrieval_runs(id TEXT PRIMARY KEY, query_id TEXT NOT NULL, workspace_id TEXT NOT NULL, manifest_json TEXT NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS retrieval_items(run_id TEXT NOT NULL, item_id TEXT NOT NULL, selected INTEGER NOT NULL, method TEXT NOT NULL, score REAL NOT NULL, PRIMARY KEY(run_id,item_id));
            CREATE TABLE IF NOT EXISTS context_manifests(request_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_trace_events(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, message_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL, source_refs_json TEXT NOT NULL, metadata_json TEXT NOT NULL, started_at TEXT, completed_at TEXT, duration_ms INTEGER, created_at TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_sequence ON agent_trace_events(run_id,sequence);
            CREATE TABLE IF NOT EXISTS source_references(id TEXT PRIMARY KEY, run_id TEXT, source_type TEXT NOT NULL, title TEXT NOT NULL, file_path TEXT, start_line INTEGER, end_line INTEGER, url TEXT, symbol TEXT);
            """)
            try:
                conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS workspace_index_fts USING fts5(id UNINDEXED, workspace_id UNINDEXED, file_path, symbol_name, content)")
            except sqlite3.OperationalError as exc:
                logger.warning("SQLite FTS5 is unavailable; lexical fallback remains active: %s", exc)

    def start_sync(self, root_value: str, changed_paths: list[str], force: bool, reason: str) -> dict:
        root = Path(root_value).resolve()
        wid = workspace_id(root)
        lock = self._workspace_locks.setdefault(wid, threading.Lock())
        if lock.locked():
            active = next((j for j in self._jobs.values() if j["workspace_id"] == wid and j["state"] == "indexing"), None)
            return active or {"workspace_id": wid, "state": "indexing"}
        job_id = f"idx-{uuid.uuid4()}"
        self._jobs[job_id] = {"job_id": job_id, "workspace_id": wid, "workspace_root": str(root), "state": "indexing", "reason": reason}
        thread = threading.Thread(target=self._sync_job, args=(job_id, root, changed_paths, force, lock), daemon=True)
        thread.start()
        return self._jobs[job_id]

    def _sync_job(self, job_id: str, root: Path, changed_paths: list[str], force: bool, lock: threading.Lock) -> None:
        started = time.perf_counter()
        with lock:
            try:
                result = self.sync(root, changed_paths, force)
                self._jobs[job_id].update(result, state="ready")
            except Exception as exc:
                self._jobs[job_id].update(state="error", error=str(exc)[:500])
            finally:
                self._jobs[job_id]["duration_ms"] = round((time.perf_counter() - started) * 1000)

    def sync(self, root: Path, changed_paths: list[str] | None = None, force: bool = False) -> dict:
        if not root.is_dir():
            raise ValueError("workspace_root existiert nicht oder ist kein Verzeichnis")
        started = time.perf_counter()
        wid = workspace_id(root)
        ignore_patterns = self._ignore_patterns(root)
        all_files = {self._relative(path, root): path for path in self._iter_files(root, ignore_patterns)}
        requested = {
            p.replace("\\", "/")[2:] if p.replace("\\", "/").startswith("./") else p.replace("\\", "/")
            for p in (changed_paths or [])
        }
        targets = all_files if force or not requested else {p: path for p, path in all_files.items() if p in requested}
        ast_chunks = self._typescript_ast_chunks([path for path in targets.values() if path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}])
        with self._connect() as conn:
            conn.execute("INSERT INTO workspaces(id,root) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET root=excluded.root", (wid, str(root)))
            known = {row["path"]: row["content_hash"] for row in conn.execute("SELECT path,content_hash FROM workspace_files WHERE workspace_id=?", (wid,))}
            if force or not requested:
                for deleted in set(known) - set(all_files):
                    self._delete_file(conn, wid, deleted)
            else:
                for deleted in requested & (set(known) - set(all_files)):
                    self._delete_file(conn, wid, deleted)
            changed = 0
            for rel, path in targets.items():
                raw = path.read_bytes()
                if b"\0" in raw[:2048]:
                    continue
                digest = hashlib.sha256(raw).hexdigest()
                if not force and known.get(rel) == digest:
                    continue
                text = raw.decode("utf-8", errors="ignore")
                self._delete_file(conn, wid, rel)
                language = self._language(path)
                imports = sorted(set(filter(None, (a or b or c for a, b, c in IMPORT_RE.findall(text)))))
                exports = EXPORT_RE.findall(text)
                indexed_at = now_iso()
                conn.execute("INSERT INTO workspace_files VALUES(?,?,?,?,?)", (wid, rel, digest, language, indexed_at))
                for chunk in self._chunks(path, text, ast_chunks.get(str(path))):
                    chunk_hash = hashlib.sha256(chunk.content.encode("utf-8")).hexdigest()
                    entry_id = hashlib.sha256(f"{wid}:{rel}:{chunk.symbol or ''}:{chunk.start}:{chunk.end}".encode()).hexdigest()
                    source_type = self._source_type(rel)
                    values = (entry_id, wid, source_type, rel, language, chunk.symbol, chunk.kind, chunk.start, chunk.end, chunk.content, chunk_hash, estimate_tokens(chunk.content), json.dumps(imports), json.dumps(exports), indexed_at)
                    conn.execute("INSERT INTO workspace_index VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", values)
                    try:
                        conn.execute("INSERT INTO workspace_index_fts VALUES(?,?,?,?,?)", (entry_id, wid, rel, chunk.symbol or "", chunk.content))
                    except sqlite3.OperationalError:
                        pass
                changed += 1
            duration = round((time.perf_counter() - started) * 1000)
            conn.execute("UPDATE workspaces SET last_indexed_at=?,duration_ms=?,error=NULL WHERE id=?", (now_iso(), duration, wid))
        return {**self.status(wid), "changed_files": changed}

    def status(self, wid: str) -> dict:
        active = next((j for j in self._jobs.values() if j["workspace_id"] == wid and j["state"] == "indexing"), None)
        with self._connect() as conn:
            ws = conn.execute("SELECT * FROM workspaces WHERE id=?", (wid,)).fetchone()
            files = conn.execute("SELECT COUNT(*) c FROM workspace_files WHERE workspace_id=?", (wid,)).fetchone()["c"]
            chunks = conn.execute("SELECT COUNT(*) c FROM workspace_index WHERE workspace_id=?", (wid,)).fetchone()["c"]
            embeddings = conn.execute("SELECT COUNT(*) c FROM embedding_cache e JOIN workspace_index i ON i.id=e.source_id WHERE i.workspace_id=?", (wid,)).fetchone()["c"]
        return {"workspace_id": wid, "workspace_root": ws["root"] if ws else "", "state": "indexing" if active else ("ready" if ws else "idle"), "file_count": files, "chunk_count": chunks, "embedding_count": embeddings, "last_indexed_at": ws["last_indexed_at"] if ws else None, "duration_ms": ws["duration_ms"] if ws else None, "error": ws["error"] if ws else None}

    def clear_index(self, wid: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM workspaces WHERE id=?", (wid,))
            try: conn.execute("DELETE FROM workspace_index_fts WHERE workspace_id=?", (wid,))
            except sqlite3.OperationalError as exc: logger.debug("FTS cleanup skipped: %s", exc)

    def clear_embeddings(self, wid: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM embedding_cache WHERE source_id IN (SELECT id FROM workspace_index WHERE workspace_id=?)", (wid,))

    def upsert_embeddings(self, entries: list) -> int:
        with self._connect() as conn:
            for entry in entries:
                vector = struct.pack(f"<{len(entry.vector)}f", *entry.vector)
                conn.execute("""INSERT OR REPLACE INTO embedding_cache
                    (source_id,content_hash,embedding_model_id,dimensions,vector,token_count,created_at)
                    VALUES(?,?,?,?,?,?,?)""", (entry.source_id, entry.content_hash, entry.embedding_model_id, len(entry.vector), vector, entry.token_count, now_iso()))
        return len(entries)

    def missing_embeddings(self, model_id: str, entries: list) -> list[str]:
        if not entries:
            return []
        with self._connect() as conn:
            return [entry.source_id for entry in entries if conn.execute(
                "SELECT 1 FROM embedding_cache WHERE source_id=? AND content_hash=? AND embedding_model_id=?",
                (entry.source_id, entry.content_hash, model_id),
            ).fetchone() is None]

    def retrieve(self, query: RetrievalQuery) -> dict:
        started = time.perf_counter()
        tokens = [t for t in re.split(r"[^\w./-]+", query.query.lower()) if len(t) >= 2]
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM workspace_index WHERE workspace_id=?", (query.workspace_id,)).fetchall()
            fts_scores: dict[str, float] = {}
            if tokens:
                try:
                    expression = " OR ".join(f'"{token.replace(chr(34), "")}"' for token in tokens[:20])
                    for match in conn.execute("SELECT id,bm25(workspace_index_fts) rank FROM workspace_index_fts WHERE workspace_id=? AND workspace_index_fts MATCH ? LIMIT ?", (query.workspace_id, expression, query.max_candidates)):
                        fts_scores[match["id"]] = max(0.0, 25.0 + (-float(match["rank"])))
                except sqlite3.OperationalError as exc:
                    logger.debug("FTS5 query failed; using deterministic text scoring: %s", exc)
            embedding_scores: dict[str, float] = {}
            cache_hits = 0
            if query.query_embedding and query.embedding_model_id:
                norm_query = math.sqrt(sum(value * value for value in query.query_embedding))
                if norm_query > 0:
                    for cached in conn.execute("""SELECT e.source_id,e.dimensions,e.vector FROM embedding_cache e
                        JOIN workspace_index i ON i.id=e.source_id WHERE i.workspace_id=? AND e.embedding_model_id=?""", (query.workspace_id, query.embedding_model_id)):
                        if cached["dimensions"] != len(query.query_embedding): continue
                        vector = struct.unpack(f"<{cached['dimensions']}f", cached["vector"])
                        norm = math.sqrt(sum(value * value for value in vector))
                        if norm > 0:
                            embedding_scores[cached["source_id"]] = sum(a*b for a,b in zip(query.query_embedding, vector)) / (norm_query * norm)
                            cache_hits += 1
        candidates: list[dict] = []
        mentioned_paths = {p.replace("\\", "/").lower() for p in query.mentioned_paths}
        mentioned_symbols = {s.lower() for s in query.mentioned_symbols}
        for row in rows:
            path = row["file_path"].lower(); symbol = (row["symbol_name"] or "").lower(); content = row["content"].lower()
            if not is_context_path_allowed(path):
                continue
            score = 0.0; method = "bm25"
            if any(path == p or path.endswith(p) for p in mentioned_paths): score += 100; method = "exact"
            if any(s == symbol or s in symbol for s in mentioned_symbols): score += 90; method = "symbol"
            if query.active_file_path and path.endswith(query.active_file_path.replace("\\", "/").lower()): score += 60; method = "active_editor"
            path_hits = sum(1 for t in tokens if t in path); symbol_hits = sum(1 for t in tokens if t in symbol); text_hits = sum(content.count(t) for t in tokens)
            score += path_hits * 14 + symbol_hits * 18 + min(text_hits, 20) * 1.5
            if row["id"] in fts_scores:
                score += fts_scores[row["id"]]
                if method == "bm25": method = "bm25"
            if row["id"] in embedding_scores:
                score += max(0.0, embedding_scores[row["id"]]) * 30
                if score <= 30: method = "embedding"
            if query.intent in {"coding", "debugging", "review"} and row["source_type"] == "test": score += 5
            if score <= 0: continue
            candidates.append(self._item(row, method, score))
        candidates.sort(key=lambda item: (-item["final_score"], item.get("source_path", ""), item["id"]))
        candidates = candidates[: query.max_candidates]
        selected: list[dict] = []; used = 0; seen: set[tuple] = set(); dropped: list[dict] = []
        for item in candidates:
            key = (item["content_hash"], item.get("start_line"), item.get("end_line"))
            if key in seen: dropped.append({"item_id": item["id"], "reason": "duplicate"}); continue
            if len(selected) >= query.max_final_items: dropped.append({"item_id": item["id"], "reason": "low_score"}); continue
            if used + item["token_count"] > query.token_budget: dropped.append({"item_id": item["id"], "reason": "token_budget"}); continue
            seen.add(key); selected.append(item); used += item["token_count"]
        run_id = f"ret-{uuid.uuid4()}"; created = now_iso()
        manifest = {"request_id": run_id, "query_id": query.id, "workspace_id": query.workspace_id, "candidate_count": len(candidates), "reranked_count": len(embedding_scores), "selected_count": len(selected), "selected_items": [{"item_id": i["id"], "source_path": i.get("source_path"), "symbol": i.get("symbol"), "start_line": i.get("start_line"), "end_line": i.get("end_line"), "retrieval_method": i["retrieval_method"], "score": i["final_score"], "token_count": i["token_count"]} for i in selected], "dropped_items": dropped, "cache_hits": cache_hits, "cache_misses": max(0, len(rows)-cache_hits) if query.query_embedding else 0, "total_tokens": used, "created_at": created, "fallback_reason": None if embedding_scores else "embedding_model_unavailable"}
        refs = [{"id": f"src-{i['id']}", "source_type": i["source_type"], "title": i.get("symbol") or i.get("source_path") or "Quelle", "file_path": i.get("source_path"), "start_line": i.get("start_line"), "end_line": i.get("end_line"), "symbol": i.get("symbol")} for i in selected]
        with self._connect() as conn:
            conn.execute("INSERT INTO retrieval_runs VALUES(?,?,?,?,?,?)", (run_id, query.id, query.workspace_id, json.dumps(manifest), round((time.perf_counter()-started)*1000), created))
            conn.executemany("INSERT INTO retrieval_items VALUES(?,?,?,?,?)", [(run_id, i["id"], int(i in selected), i["retrieval_method"], i["final_score"]) for i in candidates])
            conn.executemany("INSERT OR REPLACE INTO source_references VALUES(?,?,?,?,?,?,?,?,?)", [(r["id"], run_id, r["source_type"], r["title"], r["file_path"], r["start_line"], r["end_line"], None, r["symbol"]) for r in refs])
        return {"candidates": candidates, "items": selected, "manifest": manifest, "source_references": refs}

    def _item(self, row: sqlite3.Row, method: str, score: float) -> dict:
        return {"id": row["id"], "source_type": row["source_type"], "source_path": row["file_path"], "title": row["symbol_name"] or row["file_path"], "symbol": row["symbol_name"], "start_line": row["start_line"], "end_line": row["end_line"], "content": row["content"], "content_hash": row["content_hash"], "token_count": row["token_count"], "retrieval_method": method, "raw_score": score, "final_score": score, "retrieved_at": now_iso()}

    def _delete_file(self, conn: sqlite3.Connection, wid: str, rel: str) -> None:
        ids = [row["id"] for row in conn.execute("SELECT id FROM workspace_index WHERE workspace_id=? AND file_path=?", (wid, rel))]
        if ids:
            conn.executemany("DELETE FROM embedding_cache WHERE source_id=?", [(i,) for i in ids])
            try: conn.executemany("DELETE FROM workspace_index_fts WHERE id=?", [(i,) for i in ids])
            except sqlite3.OperationalError as exc: logger.debug("FTS item cleanup skipped: %s", exc)
        conn.execute("DELETE FROM workspace_index WHERE workspace_id=? AND file_path=?", (wid, rel))
        conn.execute("DELETE FROM workspace_files WHERE workspace_id=? AND path=?", (wid, rel))

    def _iter_files(self, root: Path, patterns: list[str]) -> Iterable[Path]:
        for path in root.rglob("*"):
            if not path.is_file() or path.is_symlink(): continue
            rel = self._relative(path, root)
            if not is_context_path_allowed(rel) or any(part in IGNORED_DIRS for part in Path(rel).parts): continue
            if path.name.lower() in SECRET_NAMES or path.suffix.lower() in BINARY_SUFFIXES: continue
            if path.suffix.lower() not in TEXT_SUFFIXES: continue
            if any(fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(path.name, p) for p in patterns): continue
            try:
                if path.stat().st_size > 2_000_000: continue
            except OSError: continue
            yield path

    def _ignore_patterns(self, root: Path) -> list[str]:
        patterns: list[str] = []
        for name in (".gitignore", ".codeeignore"):
            file = root / name
            if file.exists():
                patterns.extend(line.strip().rstrip("/") + ("/**" if line.strip().endswith("/") else "") for line in file.read_text("utf-8", errors="ignore").splitlines() if line.strip() and not line.lstrip().startswith("!") and not line.lstrip().startswith("#"))
        return patterns

    def _typescript_ast_chunks(self, paths: list[Path]) -> dict[str, list[Chunk]]:
        if not paths:
            return {}
        helper = Path(__file__).with_name("typescript_chunker.mjs")
        try:
            completed = subprocess.run(
                ["node", str(helper)], input=json.dumps({"files": [str(path) for path in paths]}),
                text=True, encoding="utf-8", errors="replace",
                capture_output=True, check=True, timeout=60,
            )
            raw = json.loads(completed.stdout)
            return {path: [Chunk(item["symbol"], item["kind"], item["start"], item["end"], item["content"]) for item in items]
                    for path, items in raw.items() if isinstance(items, list) and items}
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
            logger.warning("TypeScript AST chunker unavailable; using language fallback: %s", exc)
            return {}

    def _chunks(self, path: Path, text: str, ast_chunks: list[Chunk] | None = None) -> list[Chunk]:
        lines = text.splitlines()
        if ast_chunks:
            return self._split_large(ast_chunks)
        if path.suffix.lower() == ".py":
            try:
                tree = ast.parse(text); chunks = []
                for node in ast.walk(tree):
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        chunks.append(Chunk(node.name, "class" if isinstance(node, ast.ClassDef) else "function", node.lineno, getattr(node, "end_lineno", node.lineno), "\n".join(lines[node.lineno-1:getattr(node, "end_lineno", node.lineno)])))
                if chunks: return self._split_large(chunks)
            except SyntaxError as exc:
                logger.debug("Python AST parsing failed for %s; using generic chunking: %s", path, exc)
        if path.suffix.lower() == ".md":
            starts = [(i+1, line.lstrip("# ").strip()) for i, line in enumerate(lines) if line.startswith("#")]
            if starts:
                return self._split_large([Chunk(title, "section", start, (starts[idx+1][0]-1 if idx+1 < len(starts) else len(lines)), "\n".join(lines[start-1:(starts[idx+1][0]-1 if idx+1 < len(starts) else len(lines))])) for idx, (start, title) in enumerate(starts)])
        matches = list(SYMBOL_RE.finditer(text))
        if path.suffix.lower() in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
            occupied = {(m.start(), m.end()) for m in matches}
            matches.extend(match for match in METHOD_RE.finditer(text) if (match.start(), match.end()) not in occupied and match.group(1) not in {"if", "for", "while", "switch", "catch", "constructor"})
            matches.sort(key=lambda match: match.start())
        if matches:
            chunks=[]
            for idx, match in enumerate(matches):
                start = text.count("\n", 0, match.start()) + 1; end = text.count("\n", 0, matches[idx+1].start()) if idx+1 < len(matches) else len(lines)
                symbol = match.group(2) if match.lastindex and match.lastindex >= 2 else match.group(1)
                kind = match.group(1) if match.lastindex and match.lastindex >= 2 else "method"
                chunks.append(Chunk(symbol, kind, start, max(start, end), "\n".join(lines[start-1:max(start,end)])))
            return self._split_large(chunks)
        return self._split_large([Chunk(None, "file", 1, max(1, len(lines)), text)])

    def _split_large(self, chunks: list[Chunk]) -> list[Chunk]:
        result=[]
        for chunk in chunks:
            if estimate_tokens(chunk.content) <= 1200: result.append(chunk); continue
            lines=chunk.content.splitlines(); offset=0
            while offset < len(lines):
                size=0; end=offset
                while end < len(lines) and (size + len(lines[end]) + 1 <= 4800 or end == offset):
                    size += len(lines[end]) + 1; end += 1
                part=lines[offset:end]
                if offset > 0 and lines:
                    part=[lines[0], *part]
                result.append(Chunk(chunk.symbol, chunk.kind, chunk.start+offset, chunk.start+end-1, "\n".join(part)))
                offset=end
        return result

    @staticmethod
    def _relative(path: Path, root: Path) -> str: return str(path.relative_to(root)).replace("\\", "/")
    @staticmethod
    def _language(path: Path) -> str: return {".ts":"typescript",".tsx":"typescript",".js":"javascript",".jsx":"javascript",".py":"python",".md":"markdown",".json":"json",".yaml":"yaml",".yml":"yaml",".toml":"toml"}.get(path.suffix.lower(), path.suffix.lstrip("."))
    @staticmethod
    def _source_type(rel: str) -> str:
        low=rel.lower()
        if "test" in low or ".spec." in low: return "test"
        if low.endswith(('.md','.txt')): return "documentation"
        if low.endswith(('.json','.yaml','.yml','.toml','.ini')): return "configuration"
        return "source_code"


_service: RagService | None = None
def get_rag_service() -> RagService:
    global _service
    if _service is None: _service = RagService()
    return _service
