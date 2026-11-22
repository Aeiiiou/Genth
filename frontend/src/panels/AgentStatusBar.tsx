import { layout } from '../office/layout'
import { useOfficeStore } from '../state/officeStore'

/** One chip per agent with its live status; clicking a chip selects that agent. */
export function AgentStatusBar() {
  const agentStatus = useOfficeStore((s) => s.agentStatus)
  const selected = useOfficeStore((s) => s.selected)
  const select = useOfficeStore((s) => s.select)

  return (
    <nav className="panel status-bar" aria-label="Agents">
      {layout.agents.map((a) => {
        const status = agentStatus[a.id]
        const active = selected?.kind === 'agent' && selected.id === a.id
        return (
          <button
            key={a.id}
            type="button"
            className={active ? 'chip chip--active' : 'chip'}
            onClick={() => select({ kind: 'agent', id: a.id })}
          >
            <span className="chip__avatar" style={{ background: a.color }} />
            <span className="chip__text">
              <strong>{a.name}</strong>
              {status && (
                <span>
                  <span className={'dot dot--' + status.tone} />
                  {status.text}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
