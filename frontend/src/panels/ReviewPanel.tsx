import { useEffect, useMemo, useState } from 'react'
import { ApiError, api, type ItemEdit, type StoredCommit, type SummaryBatch } from '../api/client'
import { useOfficeStore } from '../state/officeStore'

interface DraftItem extends ItemEdit {
  key: string
}

let nextKey = 0
const toDraft = (b: SummaryBatch): DraftItem[] =>
  b.items.map((i) => ({ key: `i${i.id}`, id: i.id, text: i.text, commitIds: [...i.commitIds] }))

/** First line of a commit message, shown as plain text (commit messages are untrusted). */
const subject = (m: string) => m.split('\n', 1)[0]
const repoName = (r: string) => r.split('/')[1] ?? r

function CommitChip({ commit, onRemove }: { commit: StoredCommit; onRemove?: () => void }) {
  return (
    <span className="chip-commit" title={`${commit.repo} · ${subject(commit.message)}`}>
      <a href={commit.url} target="_blank" rel="noopener noreferrer">
        {repoName(commit.repo)} {commit.sha.slice(0, 7)}
      </a>
      {onRemove && (
        <button type="button" aria-label="Remove citation" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}

/** Opens the review dialog for the selected draft; keyed so each draft starts with fresh state. */
export function ReviewPanel() {
  const batchId = useOfficeStore((s) => s.reviewing)
  return batchId === null ? null : <ReviewDialog key={batchId} batchId={batchId} />
}

function ReviewDialog({ batchId }: { batchId: number }) {
  const openReview = useOfficeStore((s) => s.openReview)
  const [batch, setBatch] = useState<SummaryBatch | null>(null)
  const [items, setItems] = useState<DraftItem[]>([])
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .summary(batchId)
      .then((b) => {
        if (cancelled) return
        setBatch(b)
        setItems(toDraft(b))
      })
      .catch(() => !cancelled && setError('Could not load this summary.'))
    return () => {
      cancelled = true
    }
  }, [batchId])

  const commitsById = useMemo(() => new Map((batch?.commits ?? []).map((c) => [c.id, c])), [batch])
  const sourceCommits = useMemo(
    () => (batch?.sourceCommitIds ?? []).map((id) => commitsById.get(id)).filter((c): c is StoredCommit => !!c),
    [batch, commitsById],
  )
  const covered = new Set(items.flatMap((i) => i.commitIds))
  const uncovered = sourceCommits.filter((c) => !covered.has(c.id))
  const editable = batch?.status === 'pending_review'
  const invalid = items.length === 0 || items.some((i) => !i.text.trim() || i.commitIds.length === 0)

  const update = (key: string, change: Partial<DraftItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)))
    setDirty(true)
  }
  const remove = (key: string) => {
    setItems((list) => list.filter((i) => i.key !== key))
    setDirty(true)
  }
  const add = () => {
    setItems((list) => [...list, { key: `new${nextKey++}`, text: '', commitIds: [] }])
    setDirty(true)
  }

  const act = async (fn: () => Promise<SummaryBatch>, close = false) => {
    setBusy(true)
    setError(null)
    try {
      const b = await fn()
      setBatch(b)
      setItems(toDraft(b))
      setDirty(false)
      if (close) openReview(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const payload = () => items.map(({ id, text, commitIds }) => ({ id, text, commitIds }))
  const save = () => act(() => api.editSummary(batchId, payload()))
  const approve = () =>
    act(async () => {
      if (dirty) await api.editSummary(batchId, payload())
      return api.approveSummary(batchId, note || undefined)
    }, true)
  const reject = () => act(() => api.rejectSummary(batchId, note || undefined), true)

  return (
    <div className="review-backdrop" role="dialog" aria-modal="true" aria-label="Review summary">
      <section className="panel review">
        <header className="review__head">
          <div>
            <p className="kicker">Summary review</p>
            <h2>{batch ? new Date(batch.date + 'T00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : '…'}</h2>
            {batch && (
              <p className="muted small">
                Drafted by {batch.model} · {batch.status.replace('_', ' ')}
                {batch.reviewNote ? ` · note: ${batch.reviewNote}` : ''}
              </p>
            )}
          </div>
          <button type="button" className="close" aria-label="Close" onClick={() => openReview(null)}>
            ×
          </button>
        </header>

        <p className="review__hint small">
          Every statement must cite at least one commit. Check each one says only what the commits support.
        </p>

        <ol className="review__items">
          {items.map((item, n) => {
            const available = sourceCommits.filter((c) => !item.commitIds.includes(c.id))
            return (
              <li key={item.key} className={!item.text.trim() || item.commitIds.length === 0 ? 'invalid' : undefined}>
                <span className="review__num">{n + 1}</span>
                <div className="review__body">
                  <textarea
                    value={item.text}
                    disabled={!editable}
                    rows={Math.max(2, Math.ceil(item.text.length / 85))}
                    maxLength={600}
                    placeholder="Describe the accomplishment"
                    onChange={(e) => update(item.key, { text: e.target.value })}
                  />
                  <div className="review__cites">
                    {item.commitIds.map((id) => {
                      const c = commitsById.get(id)
                      return c ? (
                        <CommitChip
                          key={id}
                          commit={c}
                          onRemove={editable ? () => update(item.key, { commitIds: item.commitIds.filter((x) => x !== id) }) : undefined}
                        />
                      ) : null
                    })}
                    {editable && available.length > 0 && (
                      <select
                        value=""
                        aria-label="Cite another commit"
                        onChange={(e) => update(item.key, { commitIds: [...item.commitIds, Number(e.target.value)] })}
                      >
                        <option value="">+ cite commit</option>
                        {available.map((c) => (
                          <option key={c.id} value={c.id}>
                            {repoName(c.repo)} {c.sha.slice(0, 7)} · {subject(c.message).slice(0, 60)}
                          </option>
                        ))}
                      </select>
                    )}
                    {item.commitIds.length === 0 && <span className="error small">Needs a citation</span>}
                  </div>
                </div>
                {editable && (
                  <button type="button" className="review__del" aria-label="Delete statement" onClick={() => remove(item.key)}>
                    ×
                  </button>
                )}
              </li>
            )
          })}
        </ol>
        {editable && (
          <button type="button" className="secondary review__add" onClick={add}>
            + Add statement
          </button>
        )}

        {uncovered.length > 0 && (
          <div className="review__uncovered">
            <p className="small">
              <b>Not covered ({uncovered.length}):</b> these commits aren't cited by any statement.
            </p>
            <ul>
              {uncovered.map((c) => (
                <li key={c.id}>
                  <CommitChip commit={c} /> <span>{subject(c.message)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="error small">{error}</p>}

        {editable && (
          <footer className="review__actions">
            <input
              type="text"
              value={note}
              maxLength={500}
              placeholder="Optional note (saved with your decision)"
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="button" className="secondary" disabled={busy || !dirty || invalid} onClick={save}>
              Save edits
            </button>
            <button type="button" className="secondary danger" disabled={busy} onClick={reject}>
              Reject
            </button>
            <button type="button" className="primary" disabled={busy || invalid} onClick={approve}>
              Approve
            </button>
          </footer>
        )}
      </section>
    </div>
  )
}
