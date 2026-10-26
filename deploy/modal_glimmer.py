"""Serve the open-weight Muse Glimmer 30B on Modal with vLLM's OpenAI-compatible server.

Untested until Modal hackathon credits land (one H100 is needed for BF16 weights, ~60 GB).

    pip install modal && modal token new
    modal deploy deploy/modal_glimmer.py

Then point Jeevan Rekha at it (.env):

    LLM_BASE_URL=https://<workspace>--jeevan-rekha-glimmer-serve.modal.run/v1
    LLM_MODEL=muse-glimmer
    LLM_API_KEY=<value of the jeevan-rekha-llm-key secret>
"""

import subprocess

import modal

MODEL_ID = "meta-models/Muse-Glimmer-30B"
VLLM_PORT = 8000

image = modal.Image.from_registry("vllm/vllm-openai:v0.28.0", add_python="3.12").entrypoint([])
hf_cache = modal.Volume.from_name("jeevan-rekha-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("jeevan-rekha-vllm-cache", create_if_missing=True)

app = modal.App("jeevan-rekha-glimmer")


@app.function(
    image=image,
    gpu="H100",
    scaledown_window=10 * 60,
    timeout=30 * 60,
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    secrets=[modal.Secret.from_name("jeevan-rekha-llm-key")],  # defines LLM_API_KEY
)
@modal.concurrent(max_inputs=32)
@modal.web_server(port=VLLM_PORT, startup_timeout=20 * 60)
def serve():
    cmd = [
        "vllm", "serve", MODEL_ID,
        "--served-model-name", "muse-glimmer",
        "--host", "0.0.0.0",
        "--port", str(VLLM_PORT),
        "--tensor-parallel-size", "1",
        "--max-model-len", "32768",
        "--enable-auto-tool-choice", "--tool-call-parser", "muse_glimmer",
        "--reasoning-parser", "muse_glimmer",
        "--generation-config", "auto",
        "--api-key", "$LLM_API_KEY",
    ]
    subprocess.Popen(" ".join(cmd), shell=True)
