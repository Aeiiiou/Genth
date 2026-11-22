import { useState } from 'react'
import { ApiError, api } from '../api/client'
import { agentById } from '../office/layout'
import { type Connection, useOfficeStore } from '../state/officeStore'

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Backend offline',
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function RunPanel() {
  const connection = useOfficeStore((s) => s.connection)
  const run = useOfficeStore((s) => s.run)
  const feed = useOfficeStore((s) => s.feed)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const running = run?.status === 'running'

  const startDemo = async () => {
    setError(null)
    setStarting(true)
    try {
      await api.startDemoRun()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? 'A run is already in progress.' : 'Could not start the run.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <section className="panel run-panel" aria-label="Runs">
      <header>
        <h3>Runs</h3>
        <span className={`conn conn--${connection}`}>
          <span className="conn__dot" />
          {CONNECTION_LABEL[connection]}
        </span>
      </header>

      {connection === 'offline' && (
        <p className="muted small">
          Start it with <code>uv run backend</code> in <code>backend/</code>.
        </p>
      )}

      {run && (
        <div className={`run-status run-status--${run.status}`}>
          <strong>
            {run.id !== null ? `Run #${run.id}` : 'Run'} · {run.status}
          </strong>
          {run.step && <span>{run.step}</span>}
        </div>
      )}

      <button
        type="button"
        className="primary"
        disabled={connection !== 'live' || running || starting}
        onClick={startDemo}
      >
        {running ? 'Run in progress…' : 'Start demo run'}
      </button>
      {error && <p className="error small">{error}</p>}

      {feed.length > 0 && (
        <ol className="feed">
          {feed.map((item) => {
            const agent = item.agentId ? agentById.get(item.agentId) : undefined
            return (
              <li key={item.id} className={item.type.startsWith('run.') ? 'feed__run' : undefined}>
                <time>{time(item.at)}</time>
                <span className="feed__dot" style={{ background: agent?.color ?? 'var(--muted)' }} />
                <span>
                  {agent && <b>{agent.name}: </b>}
                  {item.message}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
