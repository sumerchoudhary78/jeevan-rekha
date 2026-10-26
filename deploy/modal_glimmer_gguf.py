"""Muse Glimmer 30B (Meta's official Q4_K_M GGUF, ~17 GB) on one Modal L4 GPU via llama.cpp's
OpenAI-compatible server. The low-cost open-weights path; deploy/modal_glimmer.py is the BF16/vLLM one.

    modal secret create jeevan-rekha-llm-key LLM_API_KEY=<random string>
    modal run deploy/modal_glimmer_gguf.py::download      # CPU only: fetch weights into a volume
    modal deploy deploy/modal_glimmer_gguf.py

.env:
    LLM_BASE_URL=https://<workspace>--jeevan-rekha-glimmer-gguf-serve.modal.run/v1
    LLM_MODEL=muse-glimmer
    LLM_API_KEY=<same random string>
"""

import subprocess

import modal

REPO = "meta-models/Muse-Glimmer-30B-GGUF"
FILE = "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf"
MODELS = "/models"
PORT = 8080

weights = modal.Volume.from_name("jeevan-rekha-glimmer-gguf", create_if_missing=True)
app = modal.App("jeevan-rekha-glimmer-gguf")

download_image = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub[hf_transfer]==0.36.0").env(
    {"HF_HUB_ENABLE_HF_TRANSFER": "1"}
)
server_image = modal.Image.from_registry("ghcr.io/ggml-org/llama.cpp:server-cuda", add_python="3.12").entrypoint([])


@app.function(image=download_image, volumes={MODELS: weights}, timeout=60 * 60)
def download():
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(REPO, FILE, local_dir=MODELS)
    weights.commit()
    print("downloaded", path)


@app.function(
    image=server_image,
    gpu="L4",
    volumes={MODELS: weights},
    secrets=[modal.Secret.from_name("jeevan-rekha-llm-key")],
    scaledown_window=3 * 60,
    timeout=60 * 60,
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=PORT, startup_timeout=15 * 60)
def serve():
    cmd = (
        f"/app/llama-server -m {MODELS}/{FILE} --alias muse-glimmer --host 0.0.0.0 --port {PORT} "
        "-ngl 999 -fa on -c 16384 -np 2 --jinja --api-key $LLM_API_KEY"
    )
    subprocess.Popen(cmd, shell=True)
