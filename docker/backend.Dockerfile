# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src

# The backing-store extras are installed here rather than left optional: in a
# container there is always a Postgres and a Redis to talk to.
RUN pip install --no-cache-dir -e ".[postgres,redis,k8s]"

EXPOSE 8000

# /health is the probe, matching the convention trip-ai and tickup already use.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["uvicorn", "jarvis.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
