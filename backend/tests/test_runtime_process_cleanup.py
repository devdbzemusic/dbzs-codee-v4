from app.runtime.process_cleanup import collect_cleanup_candidate_pids


def test_collect_cleanup_candidate_pids_includes_managed_ports_and_runtime_signatures():
    processes = [
        {
            "pid": 4100,
            "name": "llama-server.exe",
            "cmdline": ["llama-server.exe", "--model", "D:/Models/demo.gguf", "--port", "8081"],
        },
        {
            "pid": 5200,
            "name": "python.exe",
            "cmdline": ["python", "-m", "uvicorn", "app.main:app", "--port", "8876"],
        },
        {
            "pid": 9999,
            "name": "python.exe",
            "cmdline": ["python", "-m", "http.server", "3000"],
        },
    ]

    result = collect_cleanup_candidate_pids(
        current_pid=123,
        processes=processes,
        port_pid_map={8081: 4100, 8876: 5200},
        target_ports=[8081, 8082, 8083, 8084, 8876],
    )

    assert result == [4100, 5200]


def test_collect_cleanup_candidate_pids_skips_current_pid():
    result = collect_cleanup_candidate_pids(
        current_pid=5200,
        processes=[
            {
                "pid": 5200,
                "name": "python.exe",
                "cmdline": ["python", "-m", "uvicorn", "app.main:app", "--port", "8876"],
            }
        ],
        port_pid_map={8876: 5200},
        target_ports=[8876],
    )

    assert result == []
