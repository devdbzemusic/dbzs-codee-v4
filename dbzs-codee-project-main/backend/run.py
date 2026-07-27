"""Entry point for the PyInstaller-bundled backend."""

import os

import uvicorn

from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("DBZS_BACKEND_PORT", "8876"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
