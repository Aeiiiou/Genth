import { useCallback, useEffect, useState } from 'react'
import { type AIStatus, ApiError, api, type GitHubStatus, type StoredCommit, type SummaryBatch } from '../api/client'
import { agentById } from '../office/layout'
import { type Connection, useOfficeStore } from '../state/officeStore'
import { ScheduleSection } from './ScheduleSection'

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Backend offline',
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function repoName(repo: string) {
  return repo.split('/')[1] ?? repo
}

/** First line of a commit message. Shown as plain text: commit messages are untrusted. */
function subject(message: string) {
  return message.split('\n', 1)[0]
}

export function RunPanel() {
  const connection = useOfficeStore((s) => s.connection)
  const run = useOfficeStore((s) => s.run)
  const feed = useOfficeStore((s) => s.feed)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [github, setGithub] = useState<GitHubStatus | null>(null)
  const [ai, setAi] = useState<AIStatus | null>(null)
  const [pending, setPending] = useState<SummaryBatch[]>([])
  const reviewVersion = useOfficeStore((s) => s.reviewVersion)
  const openReview = useOfficeStore((s) => s.openReview)
  const [commits, setCommits] = useState<StoredCommit[] | null>(null)
  const [showCommits, setShowCommits] = useState(true)

  const running = run?.status === 'running'
  const live = connection === 'live'

  const refresh = useCallback(() => {
    api.githubStatus().then(setGithub).catch(() => setGithub(null))
    api.aiStatus().then(setAi).catch(() => setAi(null))
    api
      .commits()
      .then((r) => setCommits(r.commits))
      .catch(() => setCommits(null))
  }, [])

  // Reload setup and today's commits when we connect and whenever a run ends.
  useEffect(() => {
    if (live && !running) refresh()
  }, [live, running, refresh])

  // Drafts waiting for review: reload on connect and whenever one is drafted or decided.
  useEffect(() => {
    if (!live) return
    api
      .summaries('pending_review')
      .then(setPending)
      .catch(() => setPending([]))
  }, [live, reviewVersion])

  const start = async (kind: 'daily' | 'demo') => {
    setError(null)
    setStarting(true)
    try {
      await (kind === 'daily' ? api.startDailyRun() : api.startDemoRun())
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('A run is already in progress.')
      else if (e instanceof ApiError && e.status === 400) setError(e.message)
      else setError('Could not start the run.')
    } finally {
      setStarting(false)
    }
  }

  const disabled = !live || running || starting
  const setupProblems = [github, ai].filter((x) => x && !x.ready && x.problem).map((x) => x!.problem!)
  const ready = !!github?.ready && !!ai?.ready

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

      {live &&
        setupProblems.map((p) => (
          <p key={p} className="setup small">
            <b>Setup:</b> {p}
          </p>
        ))}

      {pending.length > 0 && (
        <div className="pending">
          {pending.map((b) => (
            <button key={b.id} type="button" className="pending__item" onClick={() => openReview(b.id)}>
              <span>
                <b>Review</b> {new Date(b.date + 'T00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
              <span className="muted">
                {b.items.length} statement{b.items.length !== 1 ? 's' : ''} →
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="btn-stack">
        <button
          type="button"
          className="primary"
          disabled={disabled || !ready}
          onClick={() => start('daily')}
          title={
            ready && github && ai
              ? `Fetch ${github.author}'s commits from ${github.repositories.length} repos, then draft accomplishments with ${ai.model}`
              : undefined
          }
        >
          {running ? 'Run in progress…' : 'Run today'}
        </button>
        <button type="button" className="secondary" disabled={disabled} onClick={() => start('demo')}>
          Demo run
        </button>
      </div>
      {error && <p className="error small">{error}</p>}

      {live && <ScheduleSection disabled={disabled || !ready} />}

      {commits && (
        <div className="commits">
          <button type="button" className="commits__toggle" onClick={() => setShowCommits((v) => !v)} aria-expanded={showCommits}>
            {showCommits ? '▾' : '▸'} Today’s commits ({commits.length})
          </button>
          {showCommits &&
            (commits.length === 0 ? (
              <p className="muted small">None stored for today yet.</p>
            ) : (
              <ul>
                {commits.map((c) => (
                  <li key={c.id}>
                    <span className="commits__repo">{repoName(c.repo)}</span>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="commits__sha">
                      {c.sha.slice(0, 7)}
                    </a>
                    <span className="commits__msg" title={c.branches.join(', ')}>
                      {c.isMerge && <span className="tag">merge</span>}
                      {subject(c.message)}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}

      {feed.length > 0 && (
        <ol className="feed">
          {feed.map((item) => {
            const agent = item.agentId ? agentById.get(item.agentId) : undefined
            const cls = item.warning ? 'feed__warn' : item.type.startsWith('run.') ? 'feed__run' : undefined
            return (
              <li key={item.id} className={cls}>
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
