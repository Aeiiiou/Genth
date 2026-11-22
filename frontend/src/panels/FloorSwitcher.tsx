import { useEffect } from 'react'
import { layout } from '../office/layout'
import { useAgentMotion } from '../state/agentMotion'
import { useOfficeStore } from '../state/officeStore'

const floorsTopDown = [...layout.floors].sort((a, b) => b.level - a.level)

export function FloorSwitcher() {
  const focus = useOfficeStore((s) => s.focusFloor)
  const setFocus = useOfficeStore((s) => s.setFocusFloor)
  const follow = useOfficeStore((s) => s.follow)
  const setFollow = useOfficeStore((s) => s.setFollow)
  const selected = useOfficeStore((s) => s.selected)
  const floors = useAgentMotion((s) => s.floors)

  // Follow the selected agent between floors.
  const followedFloor = follow && selected?.kind === 'agent' ? floors[selected.id] : undefined
  useEffect(() => {
    if (followedFloor !== undefined) setFocus(followedFloor)
  }, [followedFloor, setFocus])

  // Keys 1..n pick a floor (1 = ground).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= layout.floors.length) setFocus(n - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocus])

  return (
    <nav className="panel floors" aria-label="Floors">
      {floorsTopDown.map((f) => {
        const here = layout.agents.filter((a) => floors[a.id] === f.level)
        return (
          <button
            key={f.level}
            type="button"
            className={f.level === focus ? 'floor floor--active' : 'floor'}
            onClick={() => setFocus(f.level)}
            title={`${f.name} (key ${f.level + 1})`}
          >
            <span className="floor__short">{f.short}</span>
            <span className="floor__name">{f.name}</span>
            <span className="floor__dots">
              {here.map((a) => (
                <span key={a.id} className="floor__dot" style={{ background: a.color }} title={a.name} />
              ))}
            </span>
          </button>
        )
      })}
      <label className="floors__follow" title="Switch floors to keep the selected bot in view">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow selected bot
      </label>
    </nav>
  )
}
