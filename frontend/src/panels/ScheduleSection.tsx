import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type ScheduleInfo, type ServerRun } from '../api/client'
import { useOfficeStore } from '../state/officeStore'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KIND_LABEL: Record<string, string> = { daily: 'Daily', github: 'Fetch', summary: 'Summary', mock: 'Demo' }
const TRIGGER_LABEL: Record<string, string> = { scheduled: 'auto', 'catch-up': 'catch-up', retry: 'retry', manual: 'manual' }

/** "Mon–Fri" for consecutive days, otherwise a comma list. */
function describeDays(days: number[]) {
  if (days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1)) {
    return `${DAY_NAMES[days[0]]}–${DAY_NAMES[days.at(-1)!]}`
  }
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

function formatWhen(iso: string, timeZone: string) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone })
}

/** Today in the schedule's time zone, as YYYY-MM-DD (the date input's max). */
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function ScheduleSection({ disabled }: { disabled: boolean }) {
  const run = useOfficeStore((s) => s.run)
  const connection = useOfficeStore((s) => s.connection)
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null)
  const [history, setHistory] = useState<ServerRun[]>([])
  const [day, setDay] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const running = run?.status === 'running'
  const refresh = useCallback(() => {
    api.schedule().then(setSchedule).catch(() => setSchedule(null))
    api
      .runs(8)
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [])

  // Refresh when connected and whenever a run starts or ends.
  useEffect(() => {
    if (connection === 'live') refresh()
  }, [connection, running, refresh])

  const toggle = async () => {
    if (!schedule) return
    try {
      setSchedule(await api.setSchedule(!schedule.enabled))
    } catch {
      setError('Could not change the schedule.')
    }
  }

  const runDay = async () => {
    setError(null)
    try {
      await api.startDailyRun(day)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the run.')
    }
  }

  const tz = schedule?.timezone ?? 'Asia/Manila'

  return (
    <div className="schedule">
      {schedule && (
        <div className="schedule__row">
          <span className={schedule.enabled ? 'schedule__on' : 'muted'}>
            {schedule.enabled ? (
              <>
                Auto {schedule.time} {describeDays(schedule.weekdays)}
                {schedule.nextRunAt && <span className="muted"> · next {formatWhen(schedule.nextRunAt, tz)}</span>}
              </>
            ) : (
              'Automatic runs off'
            )}
          </span>
          <button type="button" className={schedule.enabled ? 'switch switch--on' : 'switch'} role="switch" aria-checked={schedule.enabled} onClick={toggle} title="Automatic daily run">
            <span />
          </button>
        </div>
      )}

      <button type="button" className="commits__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? '▾' : '▸'} Other days &amp; history
      </button>
      {open && (
        <>
          <div className="schedule__pick">
            <input type="date" value={day} max={todayIn(tz)} onChange={(e) => setDay(e.target.value)} aria-label="Day to run" />
            <button type="button" className="secondary" disabled={disabled || !day} onClick={runDay}>
              Run this day
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
          {history.length > 0 && (
            <ul className="history">
              {history.map((r) => (
                <li key={r.id} className={`history--${r.status}`} title={r.error ?? undefined}>
                  <span className="history__dot" />
                  <span>
                    #{r.id} {KIND_LABEL[r.kind] ?? r.kind}
                    {r.workDate && ` ${r.workDate.slice(5)}`}
                    {r.trigger && r.trigger !== 'manual' && <span className="tag">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>}
                  </span>
                  <span className="muted">{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
