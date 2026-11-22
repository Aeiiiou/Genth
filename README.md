# Genth

A localhost multi-agent "virtual office" that will turn daily GitHub commits into WAR drafts.
The agents appear as characters in an isometric 3D office and walk around as they work.

## Run it

Two terminals:

```powershell
# 1. Backend (FastAPI) on http://127.0.0.1:8000
cd backend
uv run backend

# 2. Frontend (Vite) on http://localhost:5173
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and press **Start demo run** to watch a scripted run (fake data).

## Tests

```powershell
cd backend;  uv run pytest
cd frontend; npm test
```

## Where data lives

Everything private stays outside the repo, in `%LOCALAPPDATA%\Genth\` (override with `GENTH_DATA_DIR`):

| Path | What |
|---|---|
| `genth.db` | SQLite database (runs, tasks, agent events) |
| `secrets\session_token` | Session token required by the API; created on first start |

## Security model

The backend listens on `127.0.0.1` only and every request must:

1. name `localhost` in its `Host` header (blocks DNS-rebinding attacks),
2. come from the Vite origin if it carries an `Origin` header (blocks other websites), and
3. send the session token as `Authorization: Bearer …`.

In development the Vite proxy reads the token file and adds the header, so the browser never holds it.
