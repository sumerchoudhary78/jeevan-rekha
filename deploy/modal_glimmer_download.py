"""Fetches the Muse Glimmer 30B weights into the volume deploy/modal_glimmer.py serves from.
CPU only, and a separate app, so it runs before any GPU is available:

    modal run deploy/modal_glimmer_download.py
"""

import modal

MODEL_ID = "meta-models/Muse-Glimmer-30B"

hf_cache = modal.Volume.from_name("jeevan-rekha-hf-cache", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub[hf_transfer]==0.36.0").env(
    {"HF_HUB_ENABLE_HF_TRANSFER": "1"}
)
app = modal.App("jeevan-rekha-glimmer-download")


@app.function(image=image, volumes={"/root/.cache/huggingface": hf_cache}, timeout=60 * 60)
def download():
    from huggingface_hub import snapshot_download

    path = snapshot_download(MODEL_ID)
    hf_cache.commit()
    print("downloaded", path)
