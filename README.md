# Object-First 3D Prototype Generator (MVP)

This MVP converts a text prompt into a product spec, generates concept reference images for review, then (after you confirm) runs Meshy image-to-3D. Typical outputs include:

- `model.glb` (when selected)
- `meshy_scan.stl`, `meshy_model.obj`, and other Meshy formats you request
- `preview.png` (Meshy thumbnail when available)
- `spec.json`

## Stack

- Backend: Django + Python
- Frontend: Next.js + React + `model-viewer`
- Storage: local filesystem (`outputs/{job_id}`)

## Run Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate --noinput
python manage.py runserver 0.0.0.0:8000
```

Backend runs on [http://localhost:8000](http://localhost:8000).

### Optional Queue Worker (Redis/RQ)

By default, jobs run inline in the API process (`QUEUE_BACKEND=inline`).
To run generation in a separate worker process:

```bash
cd backend
source .venv/bin/activate
QUEUE_BACKEND=rq REDIS_URL=redis://localhost:6379/0 python manage.py runserver 0.0.0.0:8000
```

In another terminal:

```bash
cd backend
source .venv/bin/activate
REDIS_URL=redis://localhost:6379/0 python -m app.worker_runner
```

## Run Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Frontend runs on [http://localhost:3000](http://localhost:3000).

Optional frontend auth headers:

```bash
NEXT_PUBLIC_API_TOKEN=<token>
NEXT_PUBLIC_USER_ID=<user-id>
```

## API

- `POST /generate` -> create async generation job (reference images, then pause for confirmation)
- `POST /jobs/{job_id}/confirm-concept` -> continue with Meshy exports
- `GET /jobs/{job_id}` -> poll job status and fetch file URLs
- `POST /jobs/{job_id}/cancel` -> request cancellation for queued/running jobs
- `GET /outputs/{job_id}/{filename}` -> download artifacts
- `GET /sample-prompts` -> sample prompts for UI
- `GET /ready` -> readiness diagnostics for queue/storage backends

## Notes

- Prompt parsing supports `SPEC_PARSER_MODE=auto|llm|rule` (defaults to `auto`).
- For LLM parsing, set `OPENAI_API_KEY` (optional `OPENAI_MODEL`, default `gpt-4o-mini`).
- To use a non-OpenAI provider (including self-hosted open-source models) via an OpenAI-compatible API, set `OPENAI_BASE_URL`.
  - Example (DeepSeek hosted): `OPENAI_BASE_URL=https://api.deepseek.com`
  - Example (local Ollama): `OPENAI_BASE_URL=http://localhost:11434/v1` (and set `OPENAI_MODEL` to a local model id)
- Storage backend supports `STORAGE_BACKEND=local|s3` (default `local`).
- For S3 mode, configure `S3_BUCKET` and optional `S3_REGION`/`S3_PUBLIC_BASE_URL`.
- Queue backend supports `QUEUE_BACKEND=inline|rq` (default `inline`).
- For RQ mode, configure `REDIS_URL` and optional `RQ_QUEUE_NAME`.
- Optional auth: set `API_AUTH_TOKEN` and send `x-api-token` plus `x-user-id` headers.
- Jobs are user-scoped via `user_id` ownership checks.
- Error codes: `INVALID_SPEC`, `UNSUPPORTED_OBJECT_TYPE`, `GENERATION_FAILED`, `RENDER_FAILED`.
