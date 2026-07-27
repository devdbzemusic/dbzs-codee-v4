#!/usr/bin/env python3
"""
Daemon script that continuously runs agents via the Agent Runner API.
This ensures jobs in the queue are processed without needing subprocess agents.

Run via: python agent_daemon.py
"""
import os
import sys
import time
import json
from urllib import request as urlrequest
from urllib import error as urlerror

_DEFAULT_PORT = int(os.getenv("DBZS_BACKEND_PORT", "8876"))
_BACKEND_URL = f"http://127.0.0.1:{_DEFAULT_PORT}"

# All available agent roles
AGENT_ROLES = ["planner", "coder", "tester", "reviewer", "debugger", "docs"]

def _request(method: str, url: str, payload: dict = None, timeout: int = 30) -> dict:
    """Make HTTP request to backend."""
    body = json.dumps(payload).encode("utf-8") if payload else None
    req = urlrequest.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method=method,
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as e:
        return {"error": str(e), "status": e.code}
    except Exception as e:
        return {"error": str(e)}

def run_agent_once(agent_id: str, supported_roles: list[str]) -> bool:
    """Run an agent once via Agent Runner."""
    workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    payload = {
        "agent_id": agent_id,
        "workspace_root": workspace_root,
        "supported_roles": supported_roles,
    }
    
    result = _request("POST", f"{_BACKEND_URL}/agent-runner/run-once", payload)
    
    if "error" in result:
        print(f"[{agent_id}] Error: {result['error']}")
        return False
    
    state = result.get("state", "unknown")
    job_id = result.get("job_id", "none")
    
    if state == "success":
        print(f"[{agent_id}] ✓ Job {job_id} completed")
        return True
    elif state == "failed":
        message = result.get("message", "unknown error")
        print(f"[{agent_id}] ✗ Job {job_id} failed: {message}")
        return False
    else:
        print(f"[{agent_id}] ~ Job {job_id} state: {state}")
        return False

def check_backend_health() -> bool:
    """Check if backend is running."""
    try:
        result = _request("GET", f"{_BACKEND_URL}/runtime/status")
        return "error" not in result
    except Exception:
        return False

def main():
    """Main daemon loop."""
    print(f"CODEE Agent Daemon starting...")
    print(f"Backend URL: {_BACKEND_URL}")
    print(f"Supported agents: {', '.join(AGENT_ROLES)}")
    print()
    
    # Check backend availability
    if not check_backend_health():
        print("ERROR: Backend is not responding!")
        sys.exit(1)
    
    print("Backend is healthy. Starting agent loop...")
    print("Press Ctrl+C to stop.")
    print()
    
    iteration = 0
    try:
        while True:
            iteration += 1
            print(f"\n=== Iteration {iteration} ({time.strftime('%H:%M:%S')}) ===")
            
            # Try to run each agent role once
            jobs_processed = 0
            for agent_id in AGENT_ROLES:
                # Run this agent (it will claim one job if available)
                if run_agent_once(agent_id, [agent_id]):
                    jobs_processed += 1
                time.sleep(1)  # Small delay between agents
            
            if jobs_processed == 0:
                print("[daemon] No jobs available. Sleeping for 10 seconds...")
                time.sleep(10)
            else:
                print(f"[daemon] Processed {jobs_processed} jobs. Next iteration in 2 seconds...")
                time.sleep(2)
    
    except KeyboardInterrupt:
        print("\n\nDaemon stopped by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
