"""Public demo deployment of the Jeevan Rekha server on Modal (CPU only).

    modal secret create jeevan-rekha-meta MODEL_API_KEY=<key> DEMO_PASSCODE=<passcode>
    modal deploy deploy/modal_app.py

Open https://<workspace>--jeevan-rekha-web.modal.run/?code=<passcode>
One container holds the live calls and the in-memory case store, so it is capped at one.
"""

import subprocess
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent

image = (
    modal.Image.from_registry("node:24-slim", add_python="3.12")
    .entrypoint([])
    .add_local_dir(
        ROOT,
        "/app",
        copy=True,
        ignore=[".env", ".git", "node_modules", "day1/audio", "day1/results", "data/photos/*.png", "**/__pycache__", ".claude"],
    )
    .run_commands("cd /app && npm ci --omit=dev")
)

app = modal.App("jeevan-rekha")


@app.function(
    image=image,
    cpu=1.0,
    memory=1024,
    secrets=[modal.Secret.from_name("jeevan-rekha-meta")],
    max_containers=1,
    scaledown_window=15 * 60,
    timeout=24 * 60 * 60,
)
@modal.concurrent(max_inputs=200)
@modal.web_server(port=8787, startup_timeout=60)
def web():
    subprocess.Popen("cd /app && node server/index.mjs", shell=True)
