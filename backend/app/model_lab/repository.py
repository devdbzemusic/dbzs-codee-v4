from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json
import sqlite3
import uuid

from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.model_lab.analyzer import duplicate_key
from app.model_lab.models import DuplicateGroup, ModelArtifact, ModelBundle, ModelCollection, ModelCollectionCreate, ModelLabModel, ModelMetadataUpdate, ModelSource, ModelSourceCreate, ScanJob


SCHEMA_VERSION = 2


class ModelLabRepository:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or (get_app_data_dir() / "model_lab.sqlite3")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite_connection(self.db_path, foreign_keys=True) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_info (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_sources (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    path TEXT NOT NULL UNIQUE,
                    recursive INTEGER NOT NULL,
                    enabled INTEGER NOT NULL,
                    trusted INTEGER NOT NULL,
                    priority INTEGER NOT NULL,
                    include_patterns TEXT NOT NULL,
                    exclude_patterns TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_scan_at TEXT,
                    last_scan_status TEXT,
                    last_error TEXT
                );
                CREATE TABLE IF NOT EXISTS scan_jobs (
                    id TEXT PRIMARY KEY,
                    source_id TEXT,
                    status TEXT NOT NULL,
                    total_files INTEGER NOT NULL DEFAULT 0,
                    artifact_count INTEGER NOT NULL DEFAULT 0,
                    bundle_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    started_at TEXT,
                    completed_at TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    installation_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    bundle_id TEXT,
                    path TEXT NOT NULL,
                    parent_path TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    detected_name TEXT NOT NULL,
                    format TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    quantization TEXT,
                    capabilities TEXT NOT NULL,
                    modalities TEXT NOT NULL,
                    metadata TEXT NOT NULL,
                    status TEXT NOT NULL,
                    discovered_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_bundles (
                    bundle_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    primary_artifact_id TEXT,
                    artifact_ids TEXT NOT NULL,
                    source_ids TEXT NOT NULL,
                    status TEXT NOT NULL,
                    capabilities TEXT NOT NULL,
                    modalities TEXT NOT NULL,
                    evidence TEXT NOT NULL,
                    health TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_metadata (
                    bundle_id TEXT PRIMARY KEY,
                    tags TEXT NOT NULL DEFAULT '[]',
                    is_favorite INTEGER NOT NULL DEFAULT 0,
                    notes TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_collections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    color TEXT NOT NULL DEFAULT '#22D3EE',
                    description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_collection_members (
                    collection_id TEXT NOT NULL,
                    bundle_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (collection_id, bundle_id),
                    FOREIGN KEY (collection_id) REFERENCES model_collections(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_model_collection_members_bundle ON model_collection_members(bundle_id);
                """
            )
            _ensure_column(conn, "model_bundles", "health", "TEXT NOT NULL DEFAULT '{}'")
            conn.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('model_lab_schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    def create_source(self, request: ModelSourceCreate) -> ModelSource:
        now = datetime.now(UTC)
        normalized_path = str(Path(request.path).expanduser().resolve())
        existing = self.get_source_by_path(normalized_path)
        if existing is not None:
            return existing
        source = ModelSource(
            id=uuid.uuid4().hex,
            name=request.name or Path(request.path).name or request.path,
            path=normalized_path,
            recursive=request.recursive,
            enabled=request.enabled,
            trusted=request.trusted,
            priority=request.priority,
            include_patterns=request.include_patterns,
            exclude_patterns=request.exclude_patterns,
            created_at=now,
            updated_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO model_sources (
                    id, name, path, recursive, enabled, trusted, priority,
                    include_patterns, exclude_patterns, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source.id,
                    source.name,
                    source.path,
                    int(source.recursive),
                    int(source.enabled),
                    int(source.trusted),
                    source.priority,
                    json.dumps(source.include_patterns),
                    json.dumps(source.exclude_patterns),
                    _dt(source.created_at),
                    _dt(source.updated_at),
                ),
            )
        return source

    def list_sources(self) -> list[ModelSource]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM model_sources ORDER BY priority, name").fetchall()
        return [_source_from_row(row) for row in rows]

    def get_source(self, source_id: str) -> ModelSource | None:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute("SELECT * FROM model_sources WHERE id = ?", (source_id,)).fetchone()
        return _source_from_row(row) if row else None

    def get_source_by_path(self, path: str) -> ModelSource | None:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute("SELECT * FROM model_sources WHERE path = ?", (path,)).fetchone()
        return _source_from_row(row) if row else None

    def create_scan_job(self, source_id: str | None) -> ScanJob:
        now = datetime.now(UTC)
        job = ScanJob(id=uuid.uuid4().hex, source_id=source_id, status="queued", created_at=now)
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                "INSERT INTO scan_jobs (id, source_id, status, created_at) VALUES (?, ?, ?, ?)",
                (job.id, job.source_id, job.status, _dt(job.created_at)),
            )
        return job

    def update_scan_job(
        self,
        job_id: str,
        *,
        status: str,
        total_files: int = 0,
        artifact_count: int = 0,
        bundle_count: int = 0,
        error: str | None = None,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
    ) -> ScanJob:
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE scan_jobs
                SET status = ?, total_files = ?, artifact_count = ?, bundle_count = ?,
                    error = ?, started_at = COALESCE(?, started_at), completed_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    total_files,
                    artifact_count,
                    bundle_count,
                    error,
                    _dt(started_at) if started_at else None,
                    _dt(completed_at) if completed_at else None,
                    job_id,
                ),
            )
            row = conn.execute("SELECT * FROM scan_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise ValueError(f"Scan job nicht gefunden: {job_id}")
        return _job_from_row(row)

    def get_active_scan_job(self, source_id: str | None) -> ScanJob | None:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT * FROM scan_jobs
                WHERE status IN ('queued', 'running')
                  AND ((source_id IS NULL AND ? IS NULL) OR source_id = ?)
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (source_id, source_id),
            ).fetchone()
        return _job_from_row(row) if row else None

    def mark_stale_scan_jobs_failed(self, *, older_than: datetime, error: str) -> int:
        now = datetime.now(UTC)
        with sqlite_connection(self.db_path) as conn:
            cursor = conn.execute(
                """
                UPDATE scan_jobs
                SET status = 'failed', error = ?, completed_at = ?
                WHERE status IN ('queued', 'running')
                  AND COALESCE(started_at, created_at) < ?
                """,
                (error, _dt(now), _dt(older_than)),
            )
            return cursor.rowcount

    def list_jobs(self) -> list[ScanJob]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM scan_jobs ORDER BY created_at DESC").fetchall()
        return [_job_from_row(row) for row in rows]

    def save_scan_output(
        self,
        *,
        source: ModelSource,
        artifacts: list[ModelArtifact],
        bundles: list[ModelBundle],
    ) -> None:
        now = datetime.now(UTC)
        with sqlite_connection(self.db_path) as conn:
            for bundle in bundles:
                conn.execute(
                    """
                    INSERT INTO model_bundles (
                        bundle_id, name, primary_artifact_id, artifact_ids, source_ids,
                        status, capabilities, modalities, evidence, health, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bundle_id) DO UPDATE SET
                        name=excluded.name,
                        primary_artifact_id=excluded.primary_artifact_id,
                        artifact_ids=excluded.artifact_ids,
                        source_ids=excluded.source_ids,
                        status=excluded.status,
                        capabilities=excluded.capabilities,
                        modalities=excluded.modalities,
                        evidence=excluded.evidence,
                        health=excluded.health,
                        updated_at=excluded.updated_at
                    """,
                    _bundle_params(bundle),
                )
            for artifact in artifacts:
                conn.execute(
                    """
                    INSERT INTO model_artifacts (
                        artifact_id, installation_id, source_id, bundle_id, path, parent_path,
                        file_name, detected_name, format, artifact_type, size_bytes, sha256,
                        quantization, capabilities, modalities, metadata, status,
                        discovered_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(artifact_id) DO UPDATE SET
                        installation_id=excluded.installation_id,
                        source_id=excluded.source_id,
                        bundle_id=excluded.bundle_id,
                        path=excluded.path,
                        parent_path=excluded.parent_path,
                        file_name=excluded.file_name,
                        detected_name=excluded.detected_name,
                        format=excluded.format,
                        artifact_type=excluded.artifact_type,
                        size_bytes=excluded.size_bytes,
                        quantization=excluded.quantization,
                        capabilities=excluded.capabilities,
                        modalities=excluded.modalities,
                        metadata=excluded.metadata,
                        status=excluded.status,
                        updated_at=excluded.updated_at
                    """,
                    _artifact_params(artifact),
                )
            conn.execute(
                """
                UPDATE model_sources
                SET last_scan_at = ?, last_scan_status = 'completed', last_error = NULL, updated_at = ?
                WHERE id = ?
                """,
                (_dt(now), _dt(now), source.id),
            )

    def mark_source_failed(self, source: ModelSource, error: str) -> None:
        now = datetime.now(UTC)
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE model_sources
                SET last_scan_at = ?, last_scan_status = 'failed', last_error = ?, updated_at = ?
                WHERE id = ?
                """,
                (_dt(now), error, _dt(now), source.id),
            )

    def list_models(self) -> list[ModelLabModel]:
        with sqlite_connection(self.db_path) as conn:
            bundle_rows = conn.execute("SELECT * FROM model_bundles ORDER BY name").fetchall()
            artifact_rows = conn.execute("SELECT * FROM model_artifacts ORDER BY detected_name").fetchall()
            metadata_by_bundle = _metadata_by_bundle(conn)
            collections_by_bundle = _collections_by_bundle(conn)
        artifacts = [_artifact_from_row(row) for row in artifact_rows]
        by_bundle: dict[str, list[ModelArtifact]] = {}
        for artifact in artifacts:
            if artifact.bundle_id:
                by_bundle.setdefault(artifact.bundle_id, []).append(artifact)
        return [
            ModelLabModel(
                bundle=_bundle_from_row(
                    row,
                    metadata=metadata_by_bundle.get(str(row["bundle_id"])),
                    collection_ids=collections_by_bundle.get(str(row["bundle_id"]), []),
                ),
                artifacts=by_bundle.get(str(row["bundle_id"]), []),
            )
            for row in bundle_rows
        ]

    def get_model(self, bundle_id: str) -> ModelLabModel | None:
        with sqlite_connection(self.db_path) as conn:
            bundle_row = conn.execute("SELECT * FROM model_bundles WHERE bundle_id = ?", (bundle_id,)).fetchone()
            if bundle_row is None:
                return None
            artifact_rows = conn.execute(
                "SELECT * FROM model_artifacts WHERE bundle_id = ? ORDER BY artifact_type, detected_name",
                (bundle_id,),
            ).fetchall()
            metadata_by_bundle = _metadata_by_bundle(conn)
            collections_by_bundle = _collections_by_bundle(conn)
        return ModelLabModel(
            bundle=_bundle_from_row(
                bundle_row,
                metadata=metadata_by_bundle.get(bundle_id),
                collection_ids=collections_by_bundle.get(bundle_id, []),
            ),
            artifacts=[_artifact_from_row(row) for row in artifact_rows],
        )

    def update_model_metadata(self, bundle_id: str, update: ModelMetadataUpdate) -> ModelBundle:
        if self.get_model(bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {bundle_id}")
        now = datetime.now(UTC)
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO model_metadata(bundle_id, tags, is_favorite, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(bundle_id) DO UPDATE SET
                    tags = excluded.tags,
                    is_favorite = excluded.is_favorite,
                    notes = excluded.notes,
                    updated_at = excluded.updated_at
                """,
                (
                    bundle_id,
                    json.dumps(sorted({tag.strip() for tag in update.tags if tag.strip()}), sort_keys=True),
                    int(update.is_favorite),
                    update.notes,
                    _dt(now),
                    _dt(now),
                ),
            )
        model = self.get_model(bundle_id)
        if model is None:
            raise ValueError(f"Model bundle nicht gefunden: {bundle_id}")
        return model.bundle

    def list_collections(self) -> list[ModelCollection]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM model_collections ORDER BY name").fetchall()
        return [_collection_from_row(row) for row in rows]

    def create_collection(self, request: ModelCollectionCreate) -> ModelCollection:
        now = datetime.now(UTC)
        collection = ModelCollection(
            id=uuid.uuid4().hex,
            name=request.name.strip(),
            color=request.color,
            description=request.description,
            created_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO model_collections(id, name, color, description, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    color = excluded.color,
                    description = excluded.description
                """,
                (collection.id, collection.name, collection.color, collection.description, _dt(collection.created_at)),
            )
            row = conn.execute("SELECT * FROM model_collections WHERE name = ?", (collection.name,)).fetchone()
        return _collection_from_row(row)

    def add_to_collection(self, collection_id: str, bundle_id: str) -> None:
        if self.get_model(bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {bundle_id}")
        now = datetime.now(UTC)
        with sqlite_connection(self.db_path, foreign_keys=True) as conn:
            collection = conn.execute("SELECT id FROM model_collections WHERE id = ?", (collection_id,)).fetchone()
            if collection is None:
                raise ValueError(f"Collection nicht gefunden: {collection_id}")
            conn.execute(
                """
                INSERT OR IGNORE INTO model_collection_members(collection_id, bundle_id, created_at)
                VALUES (?, ?, ?)
                """,
                (collection_id, bundle_id, _dt(now)),
            )

    def remove_from_collection(self, collection_id: str, bundle_id: str) -> None:
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                "DELETE FROM model_collection_members WHERE collection_id = ? AND bundle_id = ?",
                (collection_id, bundle_id),
            )

    def find_duplicates(self) -> list[DuplicateGroup]:
        models = self.list_models()
        groups: dict[str, list[ModelBundle]] = {}
        for model in models:
            key = duplicate_key(model.bundle.name, model.bundle.health.folder_size_bytes)
            groups.setdefault(key, []).append(model.bundle)
        duplicates = []
        for key, bundles in groups.items():
            if len(bundles) < 2:
                continue
            duplicates.append(
                DuplicateGroup(
                    duplicate_key=key,
                    model_count=len(bundles),
                    total_size_bytes=sum(bundle.health.folder_size_bytes for bundle in bundles),
                    bundles=bundles,
                )
            )
        return sorted(duplicates, key=lambda group: (-group.total_size_bytes, group.duplicate_key))


def _source_from_row(row: sqlite3.Row) -> ModelSource:
    return ModelSource(
        id=str(row["id"]),
        name=row["name"],
        path=str(row["path"]),
        recursive=bool(row["recursive"]),
        enabled=bool(row["enabled"]),
        trusted=bool(row["trusted"]),
        priority=int(row["priority"]),
        include_patterns=json.loads(row["include_patterns"]),
        exclude_patterns=json.loads(row["exclude_patterns"]),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
        last_scan_at=_parse_dt(row["last_scan_at"]) if row["last_scan_at"] else None,
        last_scan_status=row["last_scan_status"],
        last_error=row["last_error"],
    )


def _job_from_row(row: sqlite3.Row) -> ScanJob:
    return ScanJob(
        id=str(row["id"]),
        source_id=row["source_id"],
        status=row["status"],
        total_files=int(row["total_files"]),
        artifact_count=int(row["artifact_count"]),
        bundle_count=int(row["bundle_count"]),
        error=row["error"],
        started_at=_parse_dt(row["started_at"]) if row["started_at"] else None,
        completed_at=_parse_dt(row["completed_at"]) if row["completed_at"] else None,
        created_at=_parse_dt(row["created_at"]),
    )


def _artifact_from_row(row: sqlite3.Row) -> ModelArtifact:
    return ModelArtifact(
        artifact_id=row["artifact_id"],
        installation_id=row["installation_id"],
        source_id=row["source_id"],
        bundle_id=row["bundle_id"],
        path=row["path"],
        parent_path=row["parent_path"],
        file_name=row["file_name"],
        detected_name=row["detected_name"],
        format=row["format"],
        artifact_type=row["artifact_type"],
        size_bytes=int(row["size_bytes"]),
        sha256=row["sha256"],
        quantization=row["quantization"],
        capabilities=json.loads(row["capabilities"]),
        modalities=json.loads(row["modalities"]),
        metadata=json.loads(row["metadata"]),
        status=row["status"],
        discovered_at=_parse_dt(row["discovered_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _bundle_from_row(
    row: sqlite3.Row,
    *,
    metadata: dict[str, object] | None = None,
    collection_ids: list[str] | None = None,
) -> ModelBundle:
    metadata = metadata or {}
    return ModelBundle(
        bundle_id=row["bundle_id"],
        name=row["name"],
        primary_artifact_id=row["primary_artifact_id"],
        artifact_ids=json.loads(row["artifact_ids"]),
        source_ids=json.loads(row["source_ids"]),
        status=row["status"],
        capabilities=json.loads(row["capabilities"]),
        modalities=json.loads(row["modalities"]),
        evidence=json.loads(row["evidence"]),
        health=json.loads(row["health"] or "{}"),
        tags=list(metadata.get("tags", [])),
        is_favorite=bool(metadata.get("is_favorite", False)),
        notes=str(metadata.get("notes", "")),
        collection_ids=collection_ids or [],
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _artifact_params(artifact: ModelArtifact) -> tuple[object, ...]:
    return (
        artifact.artifact_id,
        artifact.installation_id,
        artifact.source_id,
        artifact.bundle_id,
        artifact.path,
        artifact.parent_path,
        artifact.file_name,
        artifact.detected_name,
        artifact.format,
        artifact.artifact_type,
        artifact.size_bytes,
        artifact.sha256,
        artifact.quantization,
        json.dumps(artifact.capabilities, sort_keys=True),
        json.dumps(artifact.modalities, sort_keys=True),
        json.dumps(artifact.metadata, sort_keys=True),
        artifact.status,
        _dt(artifact.discovered_at),
        _dt(artifact.updated_at),
    )


def _bundle_params(bundle: ModelBundle) -> tuple[object, ...]:
    return (
        bundle.bundle_id,
        bundle.name,
        bundle.primary_artifact_id,
        json.dumps(bundle.artifact_ids, sort_keys=True),
        json.dumps(bundle.source_ids, sort_keys=True),
        bundle.status,
        json.dumps(bundle.capabilities, sort_keys=True),
        json.dumps(bundle.modalities, sort_keys=True),
        json.dumps(bundle.evidence, sort_keys=True),
        json.dumps(bundle.health.model_dump(mode="json"), sort_keys=True),
        _dt(bundle.created_at),
        _dt(bundle.updated_at),
    )


def _metadata_by_bundle(conn: sqlite3.Connection) -> dict[str, dict[str, object]]:
    rows = conn.execute("SELECT bundle_id, tags, is_favorite, notes FROM model_metadata").fetchall()
    return {
        str(row["bundle_id"]): {
            "tags": json.loads(row["tags"] or "[]"),
            "is_favorite": bool(row["is_favorite"]),
            "notes": row["notes"] or "",
        }
        for row in rows
    }


def _collections_by_bundle(conn: sqlite3.Connection) -> dict[str, list[str]]:
    rows = conn.execute("SELECT bundle_id, collection_id FROM model_collection_members").fetchall()
    result: dict[str, list[str]] = {}
    for row in rows:
        result.setdefault(str(row["bundle_id"]), []).append(str(row["collection_id"]))
    return result


def _collection_from_row(row: sqlite3.Row) -> ModelCollection:
    return ModelCollection(
        id=str(row["id"]),
        name=str(row["name"]),
        color=str(row["color"]),
        description=str(row["description"] or ""),
        created_at=_parse_dt(row["created_at"]),
    )


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _dt(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)
