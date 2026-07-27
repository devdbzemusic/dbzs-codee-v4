from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import sqlite3
import uuid
from typing import Any, cast

from app.core.config import get_app_data_dir
from app.core.sqlite import sqlite_connection
from app.job_spooler.models import (
    ArtifactKind,
    JobArtifact,
    JobArtifactCreateRequest,
    JobClaimRequest,
    JobCompleteRequest,
    JobDetail,
    JobEnqueueRequest,
    JobEvent,
    JobFailRequest,
    JobHeartbeatRequest,
    JobRecord,
    JobStatus,
    JobVerification,
    JobVerifyRequest,
    JobWaypointRequest,
    VerificationVerdict,
    WaypointType,
)


ACTIVE_JOB_STATES = ("claimed", "running", "waiting_verification")


class JobSpoolerService:
    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or (get_app_data_dir() / "job_spooler.sqlite3")
        self._init_db()

    def enqueue_job(self, request: JobEnqueueRequest) -> JobRecord:
        now = _utc_now()
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id,
                    title,
                    task_type,
                    priority,
                    status,
                    assigned_agent_role,
                    assigned_worker,
                    attempt_count,
                    max_attempts,
                    lease_expires_at,
                    input_payload_json,
                    output_payload_json,
                    error_message,
                    created_at,
                    updated_at,
                    completed_at
                ) VALUES (?, ?, ?, ?, 'queued', ?, NULL, 0, ?, NULL, ?, NULL, NULL, ?, ?, NULL)
                """,
                (
                    job_id,
                    request.title,
                    request.task_type,
                    request.priority,
                    request.assigned_agent_role,
                    request.max_attempts,
                    json.dumps(request.input_payload),
                    now,
                    now,
                ),
            )
            self._insert_event(
                connection,
                job_id=job_id,
                worker_id=None,
                waypoint="submitted",
                message="Job enqueued",
                progress=None,
                metadata={"task_type": request.task_type, "priority": request.priority},
            )
        return self.get_job(job_id)

    def list_jobs(self, status: JobStatus | None = None, limit: int = 100) -> list[JobRecord]:
        # Stale Jobs automatisch beim Listen requeuen, um Verstopfungen zu vermeiden
        try:
            self.requeue_stale_jobs()
        except Exception:
            pass

        with self._connect() as connection:
            if status is None:
                rows = connection.execute(
                    """
                    SELECT *
                    FROM jobs
                    ORDER BY CASE status
                        WHEN 'running' THEN 1
                        WHEN 'claimed' THEN 2
                        WHEN 'waiting_verification' THEN 3
                        WHEN 'queued' THEN 4
                        WHEN 'failed' THEN 5
                        WHEN 'completed' THEN 6
                        WHEN 'cancelled' THEN 7
                        ELSE 8
                    END, priority ASC, created_at ASC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT *
                    FROM jobs
                    WHERE status = ?
                    ORDER BY priority ASC, created_at ASC
                    LIMIT ?
                    """,
                    (status, limit),
                ).fetchall()
        return [self._to_job(row) for row in rows]

    def get_job(self, job_id: str) -> JobRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(f"Unknown job: {job_id}")
        return self._to_job(row)

    def get_job_detail(self, job_id: str) -> JobDetail:
        job = self.get_job(job_id)
        with self._connect() as connection:
            event_rows = connection.execute(
                "SELECT * FROM job_events WHERE job_id = ? ORDER BY id ASC",
                (job_id,),
            ).fetchall()
            artifact_rows = connection.execute(
                "SELECT * FROM job_artifacts WHERE job_id = ? ORDER BY id ASC",
                (job_id,),
            ).fetchall()
            verification_rows = connection.execute(
                "SELECT * FROM job_verifications WHERE job_id = ? ORDER BY id ASC",
                (job_id,),
            ).fetchall()

        return JobDetail(
            job=job,
            events=[self._to_event(row) for row in event_rows],
            artifacts=[self._to_artifact(row) for row in artifact_rows],
            verifications=[self._to_verification(row) for row in verification_rows],
        )

    def claim_next_job(self, request: JobClaimRequest) -> JobRecord | None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            roles = [role.strip() for role in request.supported_roles if role.strip()]
            params: list[Any] = []
            role_filter = ""
            if roles:
                placeholders = ",".join("?" for _ in roles)
                role_filter = f" AND (assigned_agent_role IS NULL OR assigned_agent_role IN ({placeholders}))"
                params.extend(roles)

            row = connection.execute(
                f"""
                SELECT *
                FROM jobs
                WHERE status = 'queued'
                    AND attempt_count < max_attempts
                    {role_filter}
                ORDER BY priority ASC, created_at ASC
                LIMIT 1
                """,
                params,
            ).fetchone()

            if row is None:
                connection.commit()
                return None

            job_id = str(row["id"])
            lease_expires_at = _lease_expires_at(request.lease_seconds)
            now = _utc_now()
            connection.execute(
                """
                UPDATE jobs
                SET status = 'claimed',
                    assigned_worker = ?,
                    lease_expires_at = ?,
                    attempt_count = attempt_count + 1,
                    updated_at = ?
                WHERE id = ?
                """,
                (request.worker_id, lease_expires_at, now, job_id),
            )
            self._insert_event(
                connection,
                job_id=job_id,
                worker_id=request.worker_id,
                waypoint="claimed",
                message="Job claimed by worker",
                progress=0,
                metadata={"lease_seconds": request.lease_seconds},
            )
            connection.commit()
        return self.get_job(job_id)

    def heartbeat(self, job_id: str, request: JobHeartbeatRequest) -> JobRecord:
        with self._connect() as connection:
            current = self._fetch_job(connection, job_id)
            self._assert_worker_owns_job(current, request.worker_id)
            if current.status not in ACTIVE_JOB_STATES:
                raise ValueError(f"Job is not active: {job_id}")

            lease_expires_at = _lease_expires_at(request.lease_seconds)
            connection.execute(
                """
                UPDATE jobs
                SET lease_expires_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (lease_expires_at, _utc_now(), job_id),
            )
        return self.get_job(job_id)

    def add_waypoint(self, job_id: str, request: JobWaypointRequest) -> JobEvent:
        with self._connect() as connection:
            current = self._fetch_job(connection, job_id)
            self._assert_worker_owns_job(current, request.worker_id)

            next_status = self._status_from_waypoint(current.status, request.waypoint)
            if next_status is not None and next_status != current.status:
                connection.execute(
                    "UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
                    (next_status, _utc_now(), job_id),
                )

            event_id = self._insert_event(
                connection,
                job_id=job_id,
                worker_id=request.worker_id,
                waypoint=request.waypoint,
                message=request.message,
                progress=request.progress,
                metadata=request.metadata,
            )
            row = connection.execute("SELECT * FROM job_events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise RuntimeError("Failed to fetch inserted event")
        return self._to_event(row)

    def add_artifact(self, job_id: str, request: JobArtifactCreateRequest) -> JobArtifact:
        with self._connect() as connection:
            self._fetch_job(connection, job_id)
            now = _utc_now()
            cursor = connection.execute(
                """
                INSERT INTO job_artifacts (job_id, worker_id, kind, name, content, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    request.worker_id,
                    request.kind,
                    request.name,
                    request.content,
                    json.dumps(request.metadata),
                    now,
                ),
            )
            artifact_id = int(cursor.lastrowid)
            row = connection.execute("SELECT * FROM job_artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if row is None:
            raise RuntimeError("Failed to fetch inserted artifact")
        return self._to_artifact(row)

    def verify_job(self, job_id: str, request: JobVerifyRequest) -> JobVerification:
        with self._connect() as connection:
            current = self._fetch_job(connection, job_id)
            self._assert_worker_owns_job(current, request.worker_id)

            now = _utc_now()
            cursor = connection.execute(
                """
                INSERT INTO job_verifications (
                    job_id,
                    worker_id,
                    verdict,
                    reranker_score,
                    reason,
                    evidence_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    request.worker_id,
                    request.verdict,
                    request.reranker_score,
                    request.reason,
                    json.dumps(request.evidence),
                    now,
                ),
            )
            verification_id = int(cursor.lastrowid)
            waypoint = "verification_passed" if request.verdict == "passed" else "verification_failed"
            next_status = "completed" if request.verdict == "passed" else "failed"
            connection.execute(
                """
                UPDATE jobs
                SET status = ?,
                    updated_at = ?,
                    completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
                    error_message = CASE WHEN ? = 'failed' THEN ? ELSE error_message END
                WHERE id = ?
                """,
                (
                    next_status,
                    now,
                    next_status,
                    now,
                    next_status,
                    request.reason or "Verification failed",
                    job_id,
                ),
            )
            self._insert_event(
                connection,
                job_id=job_id,
                worker_id=request.worker_id,
                waypoint=cast(WaypointType, waypoint),
                message=request.reason,
                progress=100 if request.verdict == "passed" else None,
                metadata={"reranker_score": request.reranker_score},
            )
            row = connection.execute("SELECT * FROM job_verifications WHERE id = ?", (verification_id,)).fetchone()
        if row is None:
            raise RuntimeError("Failed to fetch inserted verification")
        return self._to_verification(row)

    def complete_job(self, job_id: str, request: JobCompleteRequest) -> JobRecord:
        with self._connect() as connection:
            current = self._fetch_job(connection, job_id)
            self._assert_worker_owns_job(current, request.worker_id)

            now = _utc_now()
            connection.execute(
                """
                UPDATE jobs
                SET status = 'completed',
                    output_payload_json = ?,
                    error_message = NULL,
                    completed_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(request.output_payload), now, now, job_id),
            )
            self._insert_event(
                connection,
                job_id=job_id,
                worker_id=request.worker_id,
                waypoint="completed",
                message=request.summary,
                progress=100,
                metadata={},
            )
        return self.get_job(job_id)

    def fail_job(self, job_id: str, request: JobFailRequest) -> JobRecord:
        with self._connect() as connection:
            current = self._fetch_job(connection, job_id)
            self._assert_worker_owns_job(current, request.worker_id)

            now = _utc_now()
            connection.execute(
                """
                UPDATE jobs
                SET status = 'failed',
                    error_message = ?,
                    completed_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (request.error_message, now, now, job_id),
            )
            self._insert_event(
                connection,
                job_id=job_id,
                worker_id=request.worker_id,
                waypoint="failed",
                message=request.error_message,
                progress=None,
                metadata={},
            )
        return self.get_job(job_id)

    def requeue_stale_jobs(self) -> int:
        stale_ids: list[str] = []
        now = _utc_now()
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id
                FROM jobs
                WHERE status IN ('claimed', 'running', 'waiting_verification')
                  AND lease_expires_at IS NOT NULL
                  AND lease_expires_at < ?
                """,
                (now,),
            ).fetchall()
            stale_ids = [str(row["id"]) for row in rows]
            if not stale_ids:
                return 0

            connection.executemany(
                """
                UPDATE jobs
                SET status = 'queued',
                    assigned_worker = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                [(now, job_id) for job_id in stale_ids],
            )
            for job_id in stale_ids:
                self._insert_event(
                    connection,
                    job_id=job_id,
                    worker_id=None,
                    waypoint="requeued",
                    message="Lease expired, job requeued",
                    progress=None,
                    metadata={},
                )
        return len(stale_ids)

    def clear_jobs(self, completed_and_failed_only: bool = False) -> int:
        with self._connect() as connection:
            if completed_and_failed_only:
                cursor = connection.execute(
                    "DELETE FROM jobs WHERE status IN ('completed', 'failed', 'cancelled')"
                )
            else:
                cursor = connection.execute("DELETE FROM jobs")
            deleted_count = cursor.rowcount
            return deleted_count

    def _init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    task_type TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    assigned_agent_role TEXT,
                    assigned_worker TEXT,
                    attempt_count INTEGER NOT NULL,
                    max_attempts INTEGER NOT NULL,
                    lease_expires_at TEXT,
                    input_payload_json TEXT NOT NULL,
                    output_payload_json TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    worker_id TEXT,
                    waypoint TEXT NOT NULL,
                    message TEXT NOT NULL,
                    progress INTEGER,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    worker_id TEXT,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_verifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    worker_id TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    reranker_score REAL,
                    reason TEXT NOT NULL,
                    evidence_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
                )
                """
            )

    def _connect(self):
        return sqlite_connection(self.db_path, foreign_keys=True)

    def _fetch_job(self, connection: sqlite3.Connection, job_id: str) -> JobRecord:
        row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(f"Unknown job: {job_id}")
        return self._to_job(row)

    def _insert_event(
        self,
        connection: sqlite3.Connection,
        *,
        job_id: str,
        worker_id: str | None,
        waypoint: WaypointType,
        message: str,
        progress: int | None,
        metadata: dict[str, Any],
    ) -> int:
        cursor = connection.execute(
            """
            INSERT INTO job_events (job_id, worker_id, waypoint, message, progress, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                worker_id,
                waypoint,
                message,
                progress,
                json.dumps(metadata),
                _utc_now(),
            ),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("Failed to insert event")
        return int(cursor.lastrowid)

    def _assert_worker_owns_job(self, job: JobRecord, worker_id: str) -> None:
        if job.assigned_worker is None:
            raise PermissionError(f"Job is not assigned: {job.id}")
        if job.assigned_worker != worker_id:
            raise PermissionError(f"Worker {worker_id} does not own job {job.id}")

    def _status_from_waypoint(self, current: JobStatus, waypoint: WaypointType) -> JobStatus | None:
        if waypoint in ("started", "progress", "checkpoint"):
            return "running"
        if waypoint == "waiting_verification":
            return "waiting_verification"
        if waypoint == "requeued":
            return "queued"
        if waypoint == "completed":
            return "completed"
        if waypoint == "failed":
            return "failed"
        return current

    def _to_job(self, row: sqlite3.Row) -> JobRecord:
        return JobRecord(
            id=str(row["id"]),
            title=str(row["title"]),
            task_type=str(row["task_type"]),
            priority=int(row["priority"]),
            status=cast(JobStatus, str(row["status"])),
            assigned_agent_role=_row_optional_str(row, "assigned_agent_role"),
            assigned_worker=_row_optional_str(row, "assigned_worker"),
            attempt_count=int(row["attempt_count"]),
            max_attempts=int(row["max_attempts"]),
            lease_expires_at=_row_optional_str(row, "lease_expires_at"),
            input_payload=_parse_json_object(str(row["input_payload_json"])),
            output_payload=_parse_json_object_optional(_row_optional_str(row, "output_payload_json")),
            error_message=_row_optional_str(row, "error_message"),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            completed_at=_row_optional_str(row, "completed_at"),
        )

    def _to_event(self, row: sqlite3.Row) -> JobEvent:
        progress_value = row["progress"]
        return JobEvent(
            id=int(row["id"]),
            job_id=str(row["job_id"]),
            worker_id=_row_optional_str(row, "worker_id"),
            waypoint=cast(WaypointType, str(row["waypoint"])),
            message=str(row["message"]),
            progress=int(progress_value) if progress_value is not None else None,
            metadata=_parse_json_object(str(row["metadata_json"])),
            created_at=str(row["created_at"]),
        )

    def _to_artifact(self, row: sqlite3.Row) -> JobArtifact:
        return JobArtifact(
            id=int(row["id"]),
            job_id=str(row["job_id"]),
            worker_id=_row_optional_str(row, "worker_id"),
            kind=cast(ArtifactKind, str(row["kind"])),
            name=str(row["name"]),
            content=str(row["content"]),
            metadata=_parse_json_object(str(row["metadata_json"])),
            created_at=str(row["created_at"]),
        )

    def _to_verification(self, row: sqlite3.Row) -> JobVerification:
        score_value = row["reranker_score"]
        return JobVerification(
            id=int(row["id"]),
            job_id=str(row["job_id"]),
            worker_id=str(row["worker_id"]),
            verdict=cast(VerificationVerdict, str(row["verdict"])),
            reranker_score=float(score_value) if score_value is not None else None,
            reason=str(row["reason"]),
            evidence=_parse_json_object(str(row["evidence_json"])),
            created_at=str(row["created_at"]),
        )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _lease_expires_at(seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()


def _row_optional_str(row: sqlite3.Row, key: str) -> str | None:
    value = row[key]
    return str(value) if value is not None else None


def _parse_json_object(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(value, dict):
        return {}
    return {str(key): value for key, value in value.items()}


def _parse_json_object_optional(raw: str | None) -> dict[str, Any] | None:
    if raw is None:
        return None
    return _parse_json_object(raw)
