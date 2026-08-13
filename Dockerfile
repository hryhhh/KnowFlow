# Use slim Python base image (CPU-only, no CUDA/vLLM/GPU overhead)
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
        fonts-noto-core \
        fonts-noto-cjk \
        fontconfig \
        libgl1 && \
    fc-cache -fv && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install mineru latest (CPU-only version, no torch CUDA packages)
RUN python3 -m pip install --no-cache-dir 'mineru[core]>=3.4.0' && \
    python3 -m pip cache purge

# Copy mineru config that points to volume-mounted models
COPY mineru.json /root/mineru.json

# Copy startup script for lazy model download
COPY scripts/start-mineru.sh /usr/local/bin/start-mineru.sh
RUN chmod +x /usr/local/bin/start-mineru.sh

ENV MINERU_MODEL_SOURCE=local
ENV MINERU_BACKEND=pipeline

# Use the startup script as entrypoint
ENTRYPOINT ["/usr/local/bin/start-mineru.sh"]
