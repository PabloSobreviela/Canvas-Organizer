# Canvas Organizer Backend - Production Dockerfile
# Build: docker build -t canvas-organizer-backend .
# Run:   docker run -p 8080:8080 -e PORT=8080 canvas-organizer-backend

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

# Copy only runtime application code (avoid copying secrets or local artifacts)
COPY app.py ./
COPY auth.py ./
COPY db_firestore.py ./
COPY db.py ./
COPY storage.py ./
COPY cloud_cost_audit.py ./
COPY timezone_utils.py ./
COPY ai ./ai
COPY parsers ./parsers

# Create data directory for local storage fallback
RUN mkdir -p data/storage

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV USE_FIRESTORE=true
ENV PORT=8080
ENV GCP_PROJECT_ID=canvas-organizer-4437b
ENV GCP_LOCATION=us-central1
ENV MODEL_NAME=gemini-2.5-flash-lite

# Expose port
EXPOSE 8080

# Run with gunicorn for production
# - Workers: 1 (Cloud Run autoscales instances, not workers)
# - Threads: 8 (handle concurrent requests within a worker)
# - Timeout: 0 (no timeout, let Cloud Run handle it)
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 app:app
