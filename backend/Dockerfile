# CanvasSync Backend - Production Dockerfile
# Build: docker build -t canvassync-backend .
# Run:   docker run -p 8080:8080 -e PORT=8080 canvassync-backend

FROM python:3.11

# Set working directory
WORKDIR /app


# Install system dependencies
# Full python:3.11 image has most build tools pre-installed
# We just need to ensure pip is upgraded
RUN pip install --upgrade pip


# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt

# Copy only runtime application code (avoid copying secrets, dev tools, or
# local artifacts). Keep this list in sync with the modules app.py imports.
COPY app.py ./
COPY app_config.py ./
COPY auth.py ./
COPY canvas_token_service.py ./
COPY sync_throttle.py ./
COPY retention_service.py ./
COPY demo_service.py ./
COPY demo_memory_store.py ./
COPY db_supabase.py ./
COPY db.py ./
COPY storage.py ./
COPY timezone_utils.py ./
COPY ai ./ai
COPY parsers ./parsers
COPY demo_files ./demo_files
# Migrations are run out-of-band (not required at request time) but are included
# so retention/repair jobs can run from the same image.
COPY migrations ./migrations

# Create data directory for local storage fallback
RUN mkdir -p data/storage

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV MODEL_NAME=Qwen/Qwen3-235B-A22B-Instruct-2507
ENV LLM_BASE_URL=https://api.deepinfra.com/v1/openai

# Expose port
EXPOSE 8080

# Run with gunicorn for production
# - Workers: 1 (Cloud Run autoscales instances, not workers)
# - Threads: 8 (handle concurrent requests within a worker)
# - Timeout: 0 (no timeout, let Cloud Run handle it)
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 app:app
