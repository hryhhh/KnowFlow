#!/bin/bash
set -e

HF_CACHE="/root/.cache/huggingface/hub"

# Check if models are already present
if [ -d "$HF_CACHE/models--opendatalab--PDF-Extract-Kit-1.0" ] && \
   [ -d "$HF_CACHE/models--opendatalab--MinerU2.5-Pro-2605-1.2B" ]; then
    echo "Models already cached, starting mineru-api..."
else
    echo "Models not found in cache, downloading..."
    export MINERU_MODEL_SOURCE=huggingface
    mineru-models-download -s huggingface -m all
    echo "Models downloaded successfully."
fi

# Reset to local mode and start the API
export MINERU_MODEL_SOURCE=local
exec mineru-api --host 0.0.0.0 --port 8000
