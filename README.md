# RUTS e-Journal (MVP)

Stack:
- Frontend: React + TypeScript (Vite)
- Backend: Python FastAPI
- DB/Storage: Supabase (Postgres + Storage)
- Online lessons: Zoom (OAuth per teacher)

## Apps
- `apps/web`: frontend
- `apps/api`: backend
- `supabase/migrations`: SQL migrations

## Quick start (local)

### 1) Backend
1. Copy env:
   - `apps/api/.env.example` -> `apps/api/.env`
2. Create Python venv and install deps (see `apps/api/README.md`).
3. Run API:
   - `uvicorn app.main:app --reload --port 8000`

### 2) Frontend
1. Copy env:
   - `apps/web/.env.example` -> `apps/web/.env`
2. Install and run:
   - `npm install`
   - `npm run dev`

## Notes
- Auth is custom (username/password + JWT), not Supabase Auth.
- Supabase is used as Postgres + Storage; the API uses a Supabase service key.
