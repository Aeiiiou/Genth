# Genth

A localhost multi-agent "virtual office" that turns daily GitHub commits into WAR drafts.
Six bots work in a 3-storey isometric office building in a small night-time city:

| Bot | Role | Office |
|---|---|---|
| Boss Cheats | Supervisor: calls the meeting, assigns work | 3F |
| MEDG | GitHub Agent: fetches your commits (read-only) | 2F |
| Lil Ed | Summary Agent: drafts accomplishments with an AI model | 2F |
| Glorious YK | Reviewer: checks every statement cites a real commit | 2F |
| Young King | WAR Agent (Phase 6) | 2F |
| MEDG_PHP | GovOps Agent (Phase 7) | 2F |

Every weekday at 12:00 Boss Cheats calls a meeting on 3F, MEDG presents the day's commits, carries
them to Lil Ed, whose draft goes to Glorious YK and then up to the boss. Between runs the bots get
coffee, play games and chat. Floors switch with the panel (or keys 1–3); "Follow selected bot"
rides the elevator with whoever you've selected.

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

Open http://localhost:5173. **Run today** fetches and drafts for real; **Demo run** shows the whole
workflow with fake data.

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
