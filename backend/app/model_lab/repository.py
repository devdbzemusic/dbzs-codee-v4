from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import json
import re
import sqlite3
import uuid

from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.model_lab.analyzer import duplicate_key
from app.model_lab.models import (
    DuplicateGroup,
    HardwareProfile,
    HardwareSnapshot,
    LogicalModel,
    ModelArtifact,
    ModelBenchmarkRequest,
    ModelBenchmarkRun,
    ModelBundle,
    ModelCapabilityEvidenceRecord,
    ModelCapabilityEvidenceRequest,
    ModelCertificationRecord,
    ModelCertificationRequest,
    ModelCollection,
    ModelCollectionCreate,
    ModelExecutionPolicy,
    ModelFailureRecord,
    ModelFleetRoutingEntry,
    ModelLabModel,
    ModelMetadataUpdate,
    ModelProbeRequest,
    ModelProbeRun,
    ModelRoleAssignment,
    ModelRoleAssignmentRequest,
    ModelSource,
    ModelSourceCreate,
    ModelVariant,
    RuntimeAdapterRecord,
    RuntimePresetRecord,
    ScanJob,
)


SCHEMA_VERSION = 3


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
                    created_at TEXT NOT NULL,
                    progress_message TEXT,
                    progress_events TEXT NOT NULL DEFAULT '[]'
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
                CREATE TABLE IF NOT EXISTS logical_models (
                    logical_model_id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    family TEXT NOT NULL,
                    architecture TEXT,
                    primary_bundle_id TEXT,
                    bundle_ids TEXT NOT NULL,
                    capabilities TEXT NOT NULL,
                    modalities TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS model_variants (
                    variant_id TEXT PRIMARY KEY,
                    logical_model_id TEXT NOT NULL,
                    bundle_id TEXT NOT NULL UNIQUE,
                    primary_artifact_id TEXT,
                    display_name TEXT NOT NULL,
                    format TEXT,
                    quantization TEXT,
                    parameter_count INTEGER,
                    context_length INTEGER,
                    size_bytes INTEGER NOT NULL,
                    capabilities TEXT NOT NULL,
                    modalities TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_adapters (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    enabled INTEGER NOT NULL,
                    supported_formats TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_presets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    adapter_id TEXT NOT NULL,
                    bundle_id TEXT,
                    profile TEXT NOT NULL,
                    config TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS hardware_snapshots (
                    id TEXT PRIMARY KEY,
                    fingerprint_hash TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS probe_runs (
                    id TEXT PRIMARY KEY,
                    bundle_id TEXT NOT NULL,
                    adapter_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    allow_start INTEGER NOT NULL,
                    message TEXT NOT NULL,
                    metrics TEXT NOT NULL,
                    error TEXT,
                    started_at TEXT NOT NULL,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS benchmark_runs (
                    id TEXT PRIMARY KEY,
                    bundle_id TEXT NOT NULL,
                    adapter_id TEXT NOT NULL,
                    profile TEXT NOT NULL,
                    status TEXT NOT NULL,
                    measurements TEXT NOT NULL,
                    message TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS benchmark_measurements (
                    id TEXT PRIMARY KEY,
                    benchmark_run_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    value REAL NOT NULL,
                    unit TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS capability_evidence (
                    id TEXT PRIMARY KEY,
                    bundle_id TEXT NOT NULL,
                    capability TEXT NOT NULL,
                    evidence TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS certifications (
                    id TEXT PRIMARY KEY,
                    bundle_id TEXT NOT NULL,
                    certification TEXT NOT NULL,
                    status TEXT NOT NULL,
                    evidence TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(bundle_id, certification)
                );
                CREATE TABLE IF NOT EXISTS model_role_assignments (
                    id TEXT PRIMARY KEY,
                    bundle_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    safety_level TEXT NOT NULL,
                    enabled INTEGER NOT NULL,
                    priority INTEGER NOT NULL,
                    required_certifications TEXT NOT NULL,
                    notes TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(bundle_id, role)
                );
                CREATE TABLE IF NOT EXISTS model_failures (
                    id TEXT PRIMARY KEY,
                    bundle_id TEXT,
                    artifact_id TEXT,
                    operation TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    details TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS agent_execution_policies (
                    role TEXT PRIMARY KEY,
                    max_safety_level TEXT NOT NULL,
                    required_certifications TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_model_collection_members_bundle ON model_collection_members(bundle_id);
                CREATE INDEX IF NOT EXISTS idx_model_role_assignments_role ON model_role_assignments(role, enabled, priority);
                CREATE INDEX IF NOT EXISTS idx_certifications_bundle ON certifications(bundle_id, status);
                CREATE INDEX IF NOT EXISTS idx_probe_runs_bundle ON probe_runs(bundle_id, started_at);
                CREATE INDEX IF NOT EXISTS idx_model_variants_logical ON model_variants(logical_model_id, status);
                """
            )
            _ensure_column(conn, "model_bundles", "health", "TEXT NOT NULL DEFAULT '{}'")
            _ensure_column(conn, "scan_jobs", "progress_message", "TEXT")
            _ensure_column(conn, "scan_jobs", "progress_events", "TEXT NOT NULL DEFAULT '[]'")
            self._seed_runtime_adapters(conn)
            self._seed_runtime_presets(conn)
            self._seed_execution_policies(conn)
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

    def list_logical_models(self) -> list[LogicalModel]:
        self.rebuild_logical_models()
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM logical_models ORDER BY display_name").fetchall()
        return [_logical_model_from_row(row) for row in rows]

    def get_logical_model(self, logical_model_id: str) -> LogicalModel | None:
        self.rebuild_logical_models()
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM logical_models WHERE logical_model_id = ?",
                (logical_model_id,),
            ).fetchone()
        return _logical_model_from_row(row) if row else None

    def list_model_variants(self, logical_model_id: str | None = None) -> list[ModelVariant]:
        self.rebuild_logical_models()
        with sqlite_connection(self.db_path) as conn:
            if logical_model_id:
                rows = conn.execute(
                    "SELECT * FROM model_variants WHERE logical_model_id = ? ORDER BY display_name",
                    (logical_model_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM model_variants ORDER BY logical_model_id, display_name"
                ).fetchall()
        return [_variant_from_row(row) for row in rows]

    def rebuild_logical_models(self) -> None:
        models = self.list_models()
        now = datetime.now(UTC)
        grouped: dict[str, list[ModelBundle]] = {}
        for model in models:
            bundle = model.bundle
            family = _logical_family(bundle.name)
            grouped.setdefault(family, []).append(bundle)
        with sqlite_connection(self.db_path) as conn:
            for family, bundles in grouped.items():
                sorted_bundles = sorted(bundles, key=lambda item: (item.status != "CERTIFIED", item.name.lower()))
                primary = sorted_bundles[0]
                conn.execute(
                    """
                    INSERT INTO logical_models (
                        logical_model_id, display_name, family, architecture, primary_bundle_id,
                        bundle_ids, capabilities, modalities, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(logical_model_id) DO UPDATE SET
                        display_name=excluded.display_name,
                        family=excluded.family,
                        architecture=excluded.architecture,
                        primary_bundle_id=excluded.primary_bundle_id,
                        bundle_ids=excluded.bundle_ids,
                        capabilities=excluded.capabilities,
                        modalities=excluded.modalities,
                        status=excluded.status,
                        updated_at=excluded.updated_at
                    """,
                    (
                        _logical_model_id(family),
                        primary.name,
                        family,
                        primary.health.architecture,
                        primary.bundle_id,
                        json.dumps([bundle.bundle_id for bundle in sorted_bundles], sort_keys=True),
                        json.dumps(sorted({cap for bundle in sorted_bundles for cap in bundle.capabilities}), sort_keys=True),
                        json.dumps(sorted({mod for bundle in sorted_bundles for mod in bundle.modalities}), sort_keys=True),
                        _best_status([bundle.status for bundle in sorted_bundles]),
                        _dt(now),
                        _dt(now),
                    ),
                )
            conn.execute("DELETE FROM model_variants")
            model_by_bundle_id = {model.bundle.bundle_id: model for model in models}
            for family, bundles in grouped.items():
                logical_model_id = _logical_model_id(family)
                for bundle in bundles:
                    model = model_by_bundle_id[bundle.bundle_id]
                    primary = next(
                        (artifact for artifact in model.artifacts if artifact.artifact_id == bundle.primary_artifact_id),
                        None,
                    )
                    conn.execute(
                        """
                        INSERT INTO model_variants(
                            variant_id, logical_model_id, bundle_id, primary_artifact_id,
                            display_name, format, quantization, parameter_count,
                            context_length, size_bytes, capabilities, modalities,
                            status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            _variant_id(bundle.bundle_id),
                            logical_model_id,
                            bundle.bundle_id,
                            bundle.primary_artifact_id,
                            bundle.name,
                            primary.format if primary else None,
                            (primary.quantization if primary else None) or bundle.health.quantization,
                            bundle.health.parameters,
                            bundle.health.context_length,
                            sum(artifact.size_bytes for artifact in model.artifacts),
                            json.dumps(bundle.capabilities, sort_keys=True),
                            json.dumps(bundle.modalities, sort_keys=True),
                            bundle.status,
                            _dt(now),
                            _dt(now),
                        ),
                    )

    def list_runtime_adapters(self) -> list[RuntimeAdapterRecord]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM runtime_adapters ORDER BY priority, name").fetchall()
        return [_runtime_adapter_from_row(row) for row in rows]

    def list_runtime_presets(self) -> list[RuntimePresetRecord]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM runtime_presets ORDER BY name").fetchall()
        return [_runtime_preset_from_row(row) for row in rows]

    def record_hardware_snapshot(self, profile: HardwareProfile) -> HardwareSnapshot:
        now = datetime.now(UTC)
        snapshot = HardwareSnapshot(
            id=uuid.uuid4().hex,
            fingerprint_hash=profile.fingerprint_hash,
            payload=profile,
            created_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO hardware_snapshots(id, fingerprint_hash, payload, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    snapshot.id,
                    snapshot.fingerprint_hash,
                    snapshot.payload.model_dump_json(),
                    _dt(snapshot.created_at),
                ),
            )
        return snapshot

    def list_hardware_snapshots(self, limit: int = 25) -> list[HardwareSnapshot]:
        bounded_limit = max(1, min(limit, 100))
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM hardware_snapshots ORDER BY created_at DESC LIMIT ?",
                (bounded_limit,),
            ).fetchall()
        return [_hardware_snapshot_from_row(row) for row in rows]

    def create_probe_run(self, request: ModelProbeRequest, *, status: str, message: str, error: str | None = None) -> ModelProbeRun:
        if self.get_model(request.bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {request.bundle_id}")
        now = datetime.now(UTC)
        run = ModelProbeRun(
            id=uuid.uuid4().hex,
            bundle_id=request.bundle_id,
            adapter_id=request.adapter_id,
            status=status,
            allow_start=request.allow_start,
            message=message,
            metrics=request.runtime_options,
            error=error,
            started_at=now,
            completed_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO probe_runs(
                    id, bundle_id, adapter_id, status, allow_start, message,
                    metrics, error, started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run.id,
                    run.bundle_id,
                    run.adapter_id,
                    run.status,
                    int(run.allow_start),
                    run.message,
                    json.dumps(run.metrics, sort_keys=True),
                    run.error,
                    _dt(run.started_at),
                    _dt(run.completed_at) if run.completed_at else None,
                ),
            )
        return run

    def create_benchmark_run(self, request: ModelBenchmarkRequest, *, status: str, message: str) -> ModelBenchmarkRun:
        if self.get_model(request.bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {request.bundle_id}")
        now = datetime.now(UTC)
        run = ModelBenchmarkRun(
            id=uuid.uuid4().hex,
            bundle_id=request.bundle_id,
            adapter_id=request.adapter_id,
            profile=request.profile,
            status=status,
            measurements=request.metrics,
            message=message,
            started_at=now,
            completed_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO benchmark_runs(
                    id, bundle_id, adapter_id, profile, status, measurements,
                    message, started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run.id,
                    run.bundle_id,
                    run.adapter_id,
                    run.profile,
                    run.status,
                    json.dumps(run.measurements, sort_keys=True),
                    run.message,
                    _dt(run.started_at),
                    _dt(run.completed_at) if run.completed_at else None,
                ),
            )
        return run

    def upsert_certification(self, request: ModelCertificationRequest) -> ModelCertificationRecord:
        if self.get_model(request.bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {request.bundle_id}")
        now = datetime.now(UTC)
        record_id = uuid.uuid4().hex
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO certifications(
                    id, bundle_id, certification, status, evidence, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bundle_id, certification) DO UPDATE SET
                    status=excluded.status,
                    evidence=excluded.evidence,
                    notes=excluded.notes,
                    updated_at=excluded.updated_at
                """,
                (
                    record_id,
                    request.bundle_id,
                    request.certification,
                    request.status,
                    json.dumps(request.evidence, sort_keys=True),
                    request.notes,
                    _dt(now),
                    _dt(now),
                ),
            )
            row = conn.execute(
                "SELECT * FROM certifications WHERE bundle_id = ? AND certification = ?",
                (request.bundle_id, request.certification),
            ).fetchone()
        return _certification_from_row(row)

    def record_capability_evidence(self, request: ModelCapabilityEvidenceRequest) -> ModelCapabilityEvidenceRecord:
        if self.get_model(request.bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {request.bundle_id}")
        if not request.capability.strip():
            raise ValueError("Capability fehlt.")
        now = datetime.now(UTC)
        record = ModelCapabilityEvidenceRecord(
            id=uuid.uuid4().hex,
            bundle_id=request.bundle_id,
            capability=request.capability.strip(),
            status=request.status,
            evidence=request.evidence,
            created_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO capability_evidence(id, bundle_id, capability, evidence, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.bundle_id,
                    record.capability,
                    json.dumps(record.evidence, sort_keys=True),
                    record.status,
                    _dt(record.created_at),
                ),
            )
        return record

    def assign_model_role(self, request: ModelRoleAssignmentRequest) -> ModelRoleAssignment:
        if self.get_model(request.bundle_id) is None:
            raise ValueError(f"Model bundle nicht gefunden: {request.bundle_id}")
        max_safety = _max_safety_for_role(request.role)
        if _safety_rank(request.safety_level) > _safety_rank(max_safety):
            raise ValueError(
                f"Safety-Level {request.safety_level} ueberschreitet Policy-Maximum {max_safety} fuer Rolle {request.role}"
            )
        required = _required_certifications_for_role(request.role, request.safety_level)
        passed = self._passed_certifications(request.bundle_id)
        missing = [cert for cert in required if cert not in passed]
        if request.enabled and missing:
            raise ValueError(
                f"Rolle {request.role} braucht fehlende Zertifikate: {', '.join(missing)}"
            )
        now = datetime.now(UTC)
        assignment_id = uuid.uuid4().hex
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO model_role_assignments(
                    id, bundle_id, role, safety_level, enabled, priority,
                    required_certifications, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(bundle_id, role) DO UPDATE SET
                    safety_level=excluded.safety_level,
                    enabled=excluded.enabled,
                    priority=excluded.priority,
                    required_certifications=excluded.required_certifications,
                    notes=excluded.notes,
                    updated_at=excluded.updated_at
                """,
                (
                    assignment_id,
                    request.bundle_id,
                    request.role,
                    request.safety_level,
                    int(request.enabled),
                    request.priority,
                    json.dumps(required, sort_keys=True),
                    request.notes,
                    _dt(now),
                    _dt(now),
                ),
            )
            row = conn.execute(
                "SELECT * FROM model_role_assignments WHERE bundle_id = ? AND role = ?",
                (request.bundle_id, request.role),
            ).fetchone()
        return _role_assignment_from_row(row)

    def list_probe_runs(self, bundle_id: str | None = None) -> list[ModelProbeRun]:
        with sqlite_connection(self.db_path) as conn:
            if bundle_id:
                rows = conn.execute(
                    "SELECT * FROM probe_runs WHERE bundle_id = ? ORDER BY started_at DESC",
                    (bundle_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM probe_runs ORDER BY started_at DESC").fetchall()
        return [_probe_run_from_row(row) for row in rows]

    def list_benchmark_runs(self, bundle_id: str | None = None) -> list[ModelBenchmarkRun]:
        with sqlite_connection(self.db_path) as conn:
            if bundle_id:
                rows = conn.execute(
                    "SELECT * FROM benchmark_runs WHERE bundle_id = ? ORDER BY started_at DESC",
                    (bundle_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM benchmark_runs ORDER BY started_at DESC").fetchall()
        return [_benchmark_run_from_row(row) for row in rows]

    def list_certifications(self, bundle_id: str | None = None) -> list[ModelCertificationRecord]:
        with sqlite_connection(self.db_path) as conn:
            if bundle_id:
                rows = conn.execute(
                    "SELECT * FROM certifications WHERE bundle_id = ? ORDER BY certification",
                    (bundle_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM certifications ORDER BY bundle_id, certification").fetchall()
        return [_certification_from_row(row) for row in rows]

    def list_capability_evidence(self, bundle_id: str | None = None) -> list[ModelCapabilityEvidenceRecord]:
        with sqlite_connection(self.db_path) as conn:
            if bundle_id:
                rows = conn.execute(
                    "SELECT * FROM capability_evidence WHERE bundle_id = ? ORDER BY created_at DESC",
                    (bundle_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM capability_evidence ORDER BY bundle_id, created_at DESC").fetchall()
        return [_capability_evidence_from_row(row) for row in rows]

    def list_role_assignments(self, role: str | None = None) -> list[ModelRoleAssignment]:
        with sqlite_connection(self.db_path) as conn:
            if role:
                rows = conn.execute(
                    "SELECT * FROM model_role_assignments WHERE role = ? ORDER BY enabled DESC, priority, updated_at DESC",
                    (role,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM model_role_assignments ORDER BY role, enabled DESC, priority"
                ).fetchall()
        return [_role_assignment_from_row(row) for row in rows]

    def list_routing_map(self, role: str | None = None) -> list[ModelFleetRoutingEntry]:
        assignments = self.list_role_assignments(role=role)
        entries: list[ModelFleetRoutingEntry] = []
        for assignment in assignments:
            model = self.get_model(assignment.bundle_id)
            if model is None:
                continue
            passed = self._passed_certifications(assignment.bundle_id)
            missing = [cert for cert in assignment.required_certifications if cert not in passed]
            entries.append(
                ModelFleetRoutingEntry(
                    role=assignment.role,
                    bundle_id=assignment.bundle_id,
                    bundle_name=model.bundle.name,
                    safety_level=assignment.safety_level,
                    enabled=assignment.enabled,
                    priority=assignment.priority,
                    bundle_status=model.bundle.status,
                    capabilities=model.bundle.capabilities,
                    modalities=model.bundle.modalities,
                    required_certifications=assignment.required_certifications,
                    passed_certifications=[cert for cert in assignment.required_certifications if cert in passed],
                    missing_certifications=missing,
                    routing_allowed=assignment.enabled and not missing,
                    notes=assignment.notes,
                    updated_at=assignment.updated_at,
                )
            )
        return entries

    def list_execution_policies(self) -> list[ModelExecutionPolicy]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM agent_execution_policies ORDER BY role").fetchall()
        return [_execution_policy_from_row(row) for row in rows]

    def list_failures(self, bundle_id: str | None = None) -> list[ModelFailureRecord]:
        with sqlite_connection(self.db_path) as conn:
            if bundle_id:
                rows = conn.execute(
                    "SELECT * FROM model_failures WHERE bundle_id = ? ORDER BY created_at DESC",
                    (bundle_id,),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM model_failures ORDER BY created_at DESC").fetchall()
        return [_failure_from_row(row) for row in rows]

    def record_failure(self, *, bundle_id: str | None, operation: str, message: str, details: dict[str, object] | None = None) -> ModelFailureRecord:
        now = datetime.now(UTC)
        record = ModelFailureRecord(
            id=uuid.uuid4().hex,
            bundle_id=bundle_id,
            operation=operation,
            message=message,
            details=details or {},
            created_at=now,
        )
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO model_failures(id, bundle_id, artifact_id, operation, severity, message, details, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.bundle_id,
                    record.artifact_id,
                    record.operation,
                    record.severity,
                    record.message,
                    json.dumps(record.details, sort_keys=True),
                    _dt(record.created_at),
                ),
            )
        return record

    def _passed_certifications(self, bundle_id: str) -> set[str]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT certification FROM certifications WHERE bundle_id = ? AND status = 'passed'",
                (bundle_id,),
            ).fetchall()
        return {str(row["certification"]) for row in rows}

    def _seed_runtime_adapters(self, conn: sqlite3.Connection) -> None:
        now = _dt(datetime.now(UTC))
        adapters = [
            ("llama.cpp", "llama.cpp / llama-server", 10, ["gguf"]),
            ("ollama", "Ollama", 20, ["ollama"]),
            ("transformers", "Transformers", 30, ["safetensors", "bin"]),
            ("vllm", "vLLM", 40, ["safetensors"]),
            ("onnxruntime", "ONNX Runtime", 50, ["onnx"]),
            ("diffusers", "Diffusers", 60, ["safetensors"]),
            ("whisper", "Whisper", 70, ["gguf", "bin"]),
        ]
        for adapter_id, name, priority, formats in adapters:
            conn.execute(
                """
                INSERT INTO runtime_adapters(id, name, priority, enabled, supported_formats, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    priority=excluded.priority,
                    supported_formats=excluded.supported_formats,
                    updated_at=excluded.updated_at
                """,
                (adapter_id, name, priority, json.dumps(formats, sort_keys=True), now, now),
            )

    def _seed_runtime_presets(self, conn: sqlite3.Connection) -> None:
        now = _dt(datetime.now(UTC))
        for preset_id, name, profile, config in _LLAMA_CPP_RUNTIME_PRESETS:
            conn.execute(
                """
                INSERT INTO runtime_presets(id, name, adapter_id, bundle_id, profile, config, created_at, updated_at)
                VALUES (?, ?, 'llama.cpp', NULL, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    adapter_id=excluded.adapter_id,
                    bundle_id=excluded.bundle_id,
                    profile=excluded.profile,
                    config=excluded.config,
                    updated_at=excluded.updated_at
                """,
                (preset_id, name, profile, json.dumps(config, sort_keys=True), now, now),
            )

    def _seed_execution_policies(self, conn: sqlite3.Connection) -> None:
        now = _dt(datetime.now(UTC))
        for role, (max_safety, required) in _ROLE_POLICY.items():
            conn.execute(
                """
                INSERT INTO agent_execution_policies(role, max_safety_level, required_certifications, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(role) DO UPDATE SET
                    max_safety_level=excluded.max_safety_level,
                    required_certifications=excluded.required_certifications,
                    updated_at=excluded.updated_at
                """,
                (role, max_safety, json.dumps(required, sort_keys=True), now),
            )


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
        progress_message=row["progress_message"] if "progress_message" in row.keys() else None,
        progress_events=json.loads(row["progress_events"] or "[]") if "progress_events" in row.keys() else [],
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


def _logical_model_from_row(row: sqlite3.Row) -> LogicalModel:
    return LogicalModel(
        logical_model_id=str(row["logical_model_id"]),
        display_name=str(row["display_name"]),
        family=str(row["family"]),
        architecture=row["architecture"],
        primary_bundle_id=row["primary_bundle_id"],
        bundle_ids=json.loads(row["bundle_ids"] or "[]"),
        capabilities=json.loads(row["capabilities"] or "[]"),
        modalities=json.loads(row["modalities"] or "[]"),
        status=row["status"],
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _runtime_adapter_from_row(row: sqlite3.Row) -> RuntimeAdapterRecord:
    return RuntimeAdapterRecord(
        id=str(row["id"]),
        name=str(row["name"]),
        priority=int(row["priority"]),
        enabled=bool(row["enabled"]),
        supported_formats=json.loads(row["supported_formats"] or "[]"),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _variant_from_row(row: sqlite3.Row) -> ModelVariant:
    return ModelVariant(
        variant_id=str(row["variant_id"]),
        logical_model_id=str(row["logical_model_id"]),
        bundle_id=str(row["bundle_id"]),
        primary_artifact_id=row["primary_artifact_id"],
        display_name=str(row["display_name"]),
        format=row["format"],
        quantization=row["quantization"],
        parameter_count=int(row["parameter_count"]) if row["parameter_count"] is not None else None,
        context_length=int(row["context_length"]) if row["context_length"] is not None else None,
        size_bytes=int(row["size_bytes"]),
        capabilities=json.loads(row["capabilities"] or "[]"),
        modalities=json.loads(row["modalities"] or "[]"),
        status=row["status"],
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _runtime_preset_from_row(row: sqlite3.Row) -> RuntimePresetRecord:
    return RuntimePresetRecord(
        id=str(row["id"]),
        name=str(row["name"]),
        adapter_id=str(row["adapter_id"]),
        bundle_id=row["bundle_id"],
        profile=str(row["profile"]),
        config=json.loads(row["config"] or "{}"),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _hardware_snapshot_from_row(row: sqlite3.Row) -> HardwareSnapshot:
    return HardwareSnapshot(
        id=str(row["id"]),
        fingerprint_hash=str(row["fingerprint_hash"]),
        payload=HardwareProfile.model_validate_json(row["payload"]),
        created_at=_parse_dt(row["created_at"]),
    )


def _probe_run_from_row(row: sqlite3.Row) -> ModelProbeRun:
    return ModelProbeRun(
        id=str(row["id"]),
        bundle_id=str(row["bundle_id"]),
        adapter_id=str(row["adapter_id"]),
        status=row["status"],
        allow_start=bool(row["allow_start"]),
        message=str(row["message"]),
        metrics=json.loads(row["metrics"] or "{}"),
        error=row["error"],
        started_at=_parse_dt(row["started_at"]),
        completed_at=_parse_dt(row["completed_at"]) if row["completed_at"] else None,
    )


def _benchmark_run_from_row(row: sqlite3.Row) -> ModelBenchmarkRun:
    return ModelBenchmarkRun(
        id=str(row["id"]),
        bundle_id=str(row["bundle_id"]),
        adapter_id=str(row["adapter_id"]),
        profile=str(row["profile"]),
        status=row["status"],
        measurements=json.loads(row["measurements"] or "{}"),
        message=str(row["message"] or ""),
        started_at=_parse_dt(row["started_at"]),
        completed_at=_parse_dt(row["completed_at"]) if row["completed_at"] else None,
    )


def _certification_from_row(row: sqlite3.Row) -> ModelCertificationRecord:
    return ModelCertificationRecord(
        id=str(row["id"]),
        bundle_id=str(row["bundle_id"]),
        certification=row["certification"],
        status=row["status"],
        evidence=json.loads(row["evidence"] or "{}"),
        notes=str(row["notes"] or ""),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _capability_evidence_from_row(row: sqlite3.Row) -> ModelCapabilityEvidenceRecord:
    return ModelCapabilityEvidenceRecord(
        id=str(row["id"]),
        bundle_id=str(row["bundle_id"]),
        capability=str(row["capability"]),
        status=row["status"],
        evidence=json.loads(row["evidence"] or "{}"),
        created_at=_parse_dt(row["created_at"]),
    )


def _role_assignment_from_row(row: sqlite3.Row) -> ModelRoleAssignment:
    return ModelRoleAssignment(
        id=str(row["id"]),
        bundle_id=str(row["bundle_id"]),
        role=row["role"],
        safety_level=row["safety_level"],
        enabled=bool(row["enabled"]),
        priority=int(row["priority"]),
        required_certifications=json.loads(row["required_certifications"] or "[]"),
        notes=str(row["notes"] or ""),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _execution_policy_from_row(row: sqlite3.Row) -> ModelExecutionPolicy:
    return ModelExecutionPolicy(
        role=row["role"],
        max_safety_level=row["max_safety_level"],
        required_certifications=json.loads(row["required_certifications"] or "[]"),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _failure_from_row(row: sqlite3.Row) -> ModelFailureRecord:
    return ModelFailureRecord(
        id=str(row["id"]),
        bundle_id=row["bundle_id"],
        artifact_id=row["artifact_id"],
        operation=str(row["operation"]),
        severity=row["severity"],
        message=str(row["message"]),
        details=json.loads(row["details"] or "{}"),
        created_at=_parse_dt(row["created_at"]),
    )


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


_ROLE_POLICY: dict[str, tuple[str, list[str]]] = {
    "MAIN_AGENT": ("LEVEL_1_READ_ONLY_TOOLS", ["CHAT_VERIFIED", "INSTRUCTION_FOLLOWING_VERIFIED"]),
    "DEEP_RESEARCH_AGENT": ("LEVEL_1_READ_ONLY_TOOLS", ["DEEP_RESEARCH_VERIFIED", "READ_ONLY_AGENT_VERIFIED"]),
    "FAST_GENERAL_AGENT": ("LEVEL_1_READ_ONLY_TOOLS", ["CHAT_VERIFIED", "STRUCTURED_OUTPUT_VERIFIED"]),
    "MICRO_TOOL_AGENT": ("LEVEL_1_READ_ONLY_TOOLS", ["TOOL_CALLING_VERIFIED", "READ_ONLY_AGENT_VERIFIED"]),
    "CODING_EXECUTOR": ("LEVEL_2_WORKSPACE_WRITE", ["CODING_VERIFIED", "STRUCTURED_OUTPUT_VERIFIED"]),
    "ALGORITHM_SPECIALIST": ("LEVEL_1_READ_ONLY_TOOLS", ["CODING_VERIFIED"]),
    "REASONING_VALIDATOR": ("LEVEL_1_READ_ONLY_TOOLS", ["INSTRUCTION_FOLLOWING_VERIFIED"]),
    "REPORT_GENERATOR": ("LEVEL_0_CHAT_ONLY", ["REPORT_GENERATION_VERIFIED"]),
}


_LLAMA_CPP_RUNTIME_PRESETS: tuple[tuple[str, str, str, dict[str, object]], ...] = (
    (
        "llama-cpp-cpu-fallback",
        "CPU fallback",
        "cpu_fallback",
        {
            "gpu_layers": 0,
            "ctx": 4096,
            "batch_size": 64,
            "ubatch_size": 32,
            "cache_type_k": "f16",
            "cache_type_v": "f16",
            "flash_attention": "off",
        },
    ),
    (
        "llama-cpp-safe-balanced",
        "Safe balanced",
        "safe_balanced",
        {
            "gpu_layers": 16,
            "ctx": 4096,
            "batch_size": 128,
            "ubatch_size": 64,
            "cache_type_k": "q8_0",
            "cache_type_v": "q8_0",
            "flash_attention": "auto",
        },
    ),
    (
        "llama-cpp-best-low-latency",
        "Best low latency",
        "best_low_latency",
        {
            "gpu_layers": "full",
            "ctx": 2048,
            "batch_size": 128,
            "ubatch_size": 64,
            "cache_type_k": "q8_0",
            "cache_type_v": "q8_0",
            "flash_attention": "on",
        },
    ),
    (
        "llama-cpp-best-throughput",
        "Best throughput",
        "best_throughput",
        {
            "gpu_layers": "full",
            "ctx": 4096,
            "batch_size": 256,
            "ubatch_size": 128,
            "cache_type_k": "q8_0",
            "cache_type_v": "q8_0",
            "flash_attention": "on",
        },
    ),
    (
        "llama-cpp-large-context",
        "Large context",
        "large_context",
        {
            "gpu_layers": 8,
            "ctx": 16384,
            "batch_size": 64,
            "ubatch_size": 32,
            "cache_type_k": "q4_0",
            "cache_type_v": "q4_0",
            "flash_attention": "auto",
        },
    ),
)


_STATUS_RANK = {
    "CERTIFIED": 90,
    "BENCHMARKED": 80,
    "TUNED": 70,
    "LOADABLE": 60,
    "COMPATIBLE": 50,
    "IDENTIFIED": 40,
    "DISCOVERED": 30,
    "INCOMPLETE": 20,
    "DEGRADED": 15,
    "UNSUPPORTED": 10,
    "BROKEN": 5,
    "QUARANTINED": 0,
}


def _logical_family(name: str) -> str:
    stem = Path(name).stem.lower()
    stem = re.sub(r"(?:^|[-_.])(?:iq\d_[a-z0-9_]+|q\d(?:_[a-z0-9]+)+|q\d+|f16|bf16)(?:[-_.]|$)", "-", stem)
    tokens = stem.replace("_", "-").split("-")
    filtered = [
        token
        for token in tokens
        if token and token not in {"gguf", "model"}
    ]
    return "-".join(filtered[:6]) or stem


def _logical_model_id(family: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"dbzs:model-lab:logical:{family}").hex


def _variant_id(bundle_id: str) -> str:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"dbzs:model-lab:variant:{bundle_id}").hex


def _best_status(statuses: list[str]) -> str:
    return max(statuses or ["DISCOVERED"], key=lambda status: _STATUS_RANK.get(status, 0))


def _required_certifications_for_role(role: str, safety_level: str) -> list[str]:
    required = list(_ROLE_POLICY.get(role, ("LEVEL_0_CHAT_ONLY", []))[1])
    if safety_level in {"LEVEL_2_WORKSPACE_WRITE", "LEVEL_3_TERMINAL_LIMITED", "LEVEL_4_SHELL_AND_GIT"}:
        required.append("WRITE_AGENT_VERIFIED")
    if safety_level == "LEVEL_4_SHELL_AND_GIT":
        required.append("REPOSITORY_QA_VERIFIED")
    return sorted(set(required))


def _max_safety_for_role(role: str) -> str:
    return _ROLE_POLICY.get(role, ("LEVEL_0_CHAT_ONLY", []))[0]


def _safety_rank(safety_level: str) -> int:
    ranks = {
        "LEVEL_0_CHAT_ONLY": 0,
        "LEVEL_1_READ_ONLY_TOOLS": 1,
        "LEVEL_2_WORKSPACE_WRITE": 2,
        "LEVEL_3_TERMINAL_LIMITED": 3,
        "LEVEL_4_SHELL_AND_GIT": 4,
    }
    return ranks.get(safety_level, 0)


def _dt(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)
