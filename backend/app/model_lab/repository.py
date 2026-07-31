from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json
import sqlite3
import uuid

from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.model_lab.models import ModelArtifact, ModelBundle, ModelLabModel, ModelSource, ModelSourceCreate, ScanJob


SCHEMA_VERSION = 1


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
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
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
                        status, capabilities, modalities, evidence, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bundle_id) DO UPDATE SET
                        name=excluded.name,
                        primary_artifact_id=excluded.primary_artifact_id,
                        artifact_ids=excluded.artifact_ids,
                        source_ids=excluded.source_ids,
                        status=excluded.status,
                        capabilities=excluded.capabilities,
                        modalities=excluded.modalities,
                        evidence=excluded.evidence,
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
        artifacts = [_artifact_from_row(row) for row in artifact_rows]
        by_bundle: dict[str, list[ModelArtifact]] = {}
        for artifact in artifacts:
            if artifact.bundle_id:
                by_bundle.setdefault(artifact.bundle_id, []).append(artifact)
        return [
            ModelLabModel(bundle=_bundle_from_row(row), artifacts=by_bundle.get(str(row["bundle_id"]), []))
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
        return ModelLabModel(bundle=_bundle_from_row(bundle_row), artifacts=[_artifact_from_row(row) for row in artifact_rows])


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


def _bundle_from_row(row: sqlite3.Row) -> ModelBundle:
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
        _dt(bundle.created_at),
        _dt(bundle.updated_at),
    )


def _dt(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)
