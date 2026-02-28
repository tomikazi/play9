FROM python:3.12-slim

WORKDIR /app

# Bump PWA version on each build so clients get fresh assets (set by build script or leave default)
ARG PLAY9_VERSION=dev
ENV PLAY9_VERSION=${PLAY9_VERSION}

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 9999
ENV PYTHONPATH=/app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9999"]
