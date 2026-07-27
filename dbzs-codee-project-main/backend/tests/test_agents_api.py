from pathlib import Path

import sqlite3

from fastapi.testclient import TestClient

from app.agents.service import AgentRegistryService  # type: ignore[import-not-found]
from app.api.agents import get_agent_registry_service  # type: ignore[import-not-found]
from app.main import app  # type: ignore[import-not-found]


def _seed_legacy_agent_logs_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'coder',
                description TEXT NOT NULL,
                command TEXT NOT NULL,
                args_json TEXT NOT NULL,
                cwd TEXT,
                enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_state TEXT NOT NULL,
                last_pid INTEGER,
                last_message TEXT NOT NULL,
                last_status_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE agent_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO agents (
                id, name, role, description, command, args_json, cwd, enabled,
                created_at, updated_at, last_state, last_pid, last_message, last_status_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "planner",
                "Planner",
                "planner",
                "Legacy seed",
                "python",
                "[]",
                None,
                1,
                "2024-01-01T00:00:00Z",
                "2024-01-01T00:00:00Z",
                "stopped",
                None,
                "",
                "2024-01-01T00:00:00Z",
            ),
        )
        connection.execute(
            """
            INSERT INTO agent_logs (agent_id, level, message, timestamp)
            VALUES (?, ?, ?, ?)
            """,
            ("planner", "info", "legacy log entry", "2024-01-01T00:00:00Z"),
        )


class FakeProcess:
    def __init__(self) -> None:
        self.pid = 9001
        self._terminated = False

    def poll(self) -> int | None:
        return 0 if self._terminated else None

    def terminate(self) -> None:
        self._terminated = True

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self._terminated = True
        return 0

    def kill(self) -> None:
        self._terminated = True


class FakeRunner:
    def __init__(self) -> None:
        self.process = FakeProcess()
        self.commands: list[list[str]] = []

    def start(self, command: list[str], cwd: Path) -> FakeProcess:
        _ = cwd
        self.commands.append(command)
        return self.process


def test_agents_api_create_list_update_start_stop(tmp_path: Path) -> None:
    service = AgentRegistryService(
        db_path=tmp_path / "agents.sqlite3",
        runner=FakeRunner(),
        allowed_commands={"node", "python"},
    )
    app.dependency_overrides[get_agent_registry_service] = lambda: service
    client = TestClient(app)

    create_response = client.post(
        "/agents",
        json={
            "id": "agent_one",
            "name": "Agent One",
            "description": "runs checks",
            "command": "node",
            "args": ["--version"],
            "enabled": True,
        },
    )
    list_response = client.get("/agents")
    update_response = client.put("/agents/agent_one", json={"name": "Agent One Updated"})
    start_response = client.post("/agents/agent_one/start", json={})
    stop_response = client.post("/agents/agent_one/stop", json={})
    logs_response = client.get("/agents/agent_one/logs?limit=20")

    app.dependency_overrides.clear()

    assert create_response.status_code == 200
    assert list_response.status_code == 200
    assert update_response.status_code == 200
    assert start_response.status_code == 200
    assert stop_response.status_code == 200
    assert logs_response.status_code == 200

    created = create_response.json()
    assert created["id"] == "agent_one"
    assert list_response.json()[0]["id"] == "agent_one"
    assert update_response.json()["name"] == "Agent One Updated"
    assert start_response.json()["status"]["state"] == "running"
    assert stop_response.json()["status"]["state"] == "stopped"
    assert len(logs_response.json()) >= 1


def test_agents_api_rejects_disallowed_command(tmp_path: Path) -> None:
    service = AgentRegistryService(
        db_path=tmp_path / "agents.sqlite3",
        runner=FakeRunner(),
        allowed_commands={"node"},
    )
    app.dependency_overrides[get_agent_registry_service] = lambda: service
    client = TestClient(app)

    response = client.post(
        "/agents",
        json={
            "id": "bad_agent",
            "name": "Bad Agent",
            "description": "",
            "command": "powershell",
            "args": [],
            "enabled": True,
        },
    )

    app.dependency_overrides.clear()

    assert response.status_code == 400
    assert "Command not allowed" in response.json()["detail"]


def test_agents_api_disable_and_delete(tmp_path: Path) -> None:
    service = AgentRegistryService(
        db_path=tmp_path / "agents.sqlite3",
        runner=FakeRunner(),
        allowed_commands={"node", "python"},
    )
    app.dependency_overrides[get_agent_registry_service] = lambda: service
    client = TestClient(app)

    create_response = client.post(
        "/agents",
        json={
            "id": "agent_two",
            "name": "Agent Two",
            "description": "",
            "command": "node",
            "args": ["--version"],
            "enabled": True,
        },
    )
    disable_response = client.put("/agents/agent_two", json={"enabled": False})
    start_disabled_response = client.post("/agents/agent_two/start", json={})
    delete_response = client.delete("/agents/agent_two")
    list_response = client.get("/agents")

    app.dependency_overrides.clear()

    assert create_response.status_code == 200
    assert disable_response.status_code == 200
    assert disable_response.json()["enabled"] is False
    assert start_disabled_response.status_code == 400
    assert "Disabled agents" in start_disabled_response.json()["detail"]
    assert delete_response.status_code == 200
    assert delete_response.json()["status"] == "deleted"
    assert list_response.status_code == 200
    assert all(agent["id"] != "agent_two" for agent in list_response.json())


def test_agents_api_seeds_default_agents(tmp_path: Path) -> None:
    service = AgentRegistryService(
        db_path=tmp_path / "agents.sqlite3",
        runner=FakeRunner(),
        allowed_commands={"node", "python"},
    )
    app.dependency_overrides[get_agent_registry_service] = lambda: service
    client = TestClient(app)

    response = client.get("/agents")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    agents = response.json()
    roles = {agent["role"] for agent in agents}
    ids = {agent["id"] for agent in agents}

    assert roles.issuperset({"planner", "coder", "tester", "reviewer", "debugger", "docs"})
    assert ids.issuperset({"planner", "coder", "tester", "reviewer", "debugger", "docs"})


def test_agents_api_start_with_legacy_timestamp_logs_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "agents.sqlite3"
    _seed_legacy_agent_logs_db(db_path)

    service = AgentRegistryService(
        db_path=db_path,
        runner=FakeRunner(),
        allowed_commands={"node", "python"},
    )
    app.dependency_overrides[get_agent_registry_service] = lambda: service
    client = TestClient(app)

    start_response = client.post("/agents/planner/start", json={})
    logs_response = client.get("/agents/planner/logs?limit=20")

    app.dependency_overrides.clear()

    assert start_response.status_code == 200
    assert logs_response.status_code == 200
    messages = [entry["message"] for entry in logs_response.json()]
    assert "legacy log entry" in messages
    assert any("started" in message.lower() for message in messages)
