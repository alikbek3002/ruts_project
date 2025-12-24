# API (FastAPI)

## Environment
Copy `.env.example` to `.env` and fill values.

Важно: для работы логина нужны таблицы из миграции `supabase/migrations/20251222_000001_mvp.sql`.

## Create dev users (admin/teacher/student)
1. Заполни `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в `apps/api/.env`
2. Запусти:
	- из папки `apps/api`:
	  - `C:/Users/KK/Desktop/ruts_main/.venv/Scripts/python.exe tools/bootstrap_dev_users.py`

## Run
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
