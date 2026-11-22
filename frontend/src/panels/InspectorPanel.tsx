import type { ReactNode } from 'react'
import { furnitureCatalog } from '../office/furniture/catalog'
import { agentById, floorByLevel, furnitureById, layout, roomById, workstationById } from '../office/layout'
import { useAgentMotion } from '../state/agentMotion'
import { type Selection, useOfficeStore } from '../state/officeStore'

function Link({ to, children }: { to: Selection; children: ReactNode }) {
  const select = useOfficeStore((s) => s.select)
  return (
    <button type="button" className="link" onClick={() => select(to)}>
      {children}
    </button>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function RoomDetails({ id }: { id: string }) {
  const room = roomById.get(id)
  if (!room) return null
  const stations = layout.workstations.filter((w) => w.roomId === id)
  const items = layout.furniture.filter((f) => f.roomId === id)
  const counts = new Map<string, number>()
  for (const f of items) counts.set(furnitureCatalog[f.type].label, (counts.get(furnitureCatalog[f.type].label) ?? 0) + 1)

  return (
    <>
      <p className="kicker">Room · {floorByLevel.get(room.floor)?.short}</p>
      <h2>{room.name}</h2>
      <p className="muted">{room.purpose}</p>
      <dl>
        <Row label="Size">
          {room.size[0]} × {room.size[1]} tiles
        </Row>
        <Row label="Workstations">
          {stations.length === 0
            ? 'None'
            : stations.map((w) => {
                const agent = w.assignedAgentId ? agentById.get(w.assignedAgentId) : undefined
                return (
                  <div key={w.id}>
                    <Link to={{ kind: 'workstation', id: w.id }}>{w.label}</Link>
                    {agent ? ` · ${agent.name}` : ' · unassigned'}
                  </div>
                )
              })}
        </Row>
        <Row label="Furniture">
          {counts.size === 0
            ? 'None'
            : [...counts].map(([label, n]) => (
                <div key={label}>
                  {label}
                  {n > 1 ? ` × ${n}` : ''}
                </div>
              ))}
        </Row>
      </dl>
    </>
  )
}

function WorkstationDetails({ id }: { id: string }) {
  const ws = workstationById.get(id)
  if (!ws) return null
  const agent = ws.assignedAgentId ? agentById.get(ws.assignedAgentId) : undefined
  return (
    <>
      <p className="kicker">Workstation</p>
      <h2>{ws.label}</h2>
      <dl>
        <Row label="Room">
          <Link to={{ kind: 'room', id: ws.roomId }}>{roomById.get(ws.roomId)?.name}</Link>
        </Row>
        <Row label="Assigned to">{agent ? <Link to={{ kind: 'agent', id: agent.id }}>{agent.name}</Link> : 'Unassigned'}</Row>
        <Row label="ID">
          <code>{ws.id}</code>
        </Row>
      </dl>
    </>
  )
}

function AgentDetails({ id }: { id: string }) {
  const agent = agentById.get(id)
  const status = useOfficeStore((s) => s.agentStatus[id])
  const floor = useAgentMotion((s) => s.floors[id])
  if (!agent) return null
  const ws = workstationById.get(agent.workstationId)
  return (
    <>
      <p className="kicker">Agent</p>
      <h2>
        <span className="swatch" style={{ background: agent.color }} />
        {agent.name}
      </h2>
      <p className="muted">{agent.role}</p>
      <dl>
        <Row label="Status">
          {status ? (
            <span className="status-inline">
              <span className={'dot dot--' + status.tone} />
              {status.text}
            </span>
          ) : (
            '…'
          )}
        </Row>
        <Row label="Now on">{floorByLevel.get(floor)?.name ?? '…'}</Row>
        <Row label="Uses AI model">{agent.usesLLM ? 'Yes' : 'No: deterministic code'}</Row>
        {ws && (
          <>
            <Row label="Workstation">
              <Link to={{ kind: 'workstation', id: ws.id }}>{ws.label}</Link>
            </Row>
            <Row label="Room">
              <Link to={{ kind: 'room', id: ws.roomId }}>{roomById.get(ws.roomId)?.name}</Link>
            </Row>
          </>
        )}
      </dl>
    </>
  )
}

function FurnitureDetails({ id }: { id: string }) {
  const item = furnitureById.get(id)
  if (!item) return null
  const entry = furnitureCatalog[item.type]
  return (
    <>
      <p className="kicker">{entry.label}</p>
      <h2>{item.label ?? entry.label}</h2>
      <dl>
        <Row label="Room">
          <Link to={{ kind: 'room', id: item.roomId }}>{roomById.get(item.roomId)?.name}</Link>
        </Row>
        <Row label="ID">
          <code>{item.id}</code>
        </Row>
      </dl>
    </>
  )
}

export function InspectorPanel() {
  const selected = useOfficeStore((s) => s.selected)
  const select = useOfficeStore((s) => s.select)

  if (!selected) {
    return (
      <aside className="panel inspector inspector--empty">
        <p>Click a room, desk, agent or piece of furniture to inspect it.</p>
      </aside>
    )
  }

  return (
    <aside className="panel inspector">
      <button type="button" className="close" aria-label="Close" onClick={() => select(null)}>
        ×
      </button>
      {selected.kind === 'room' && <RoomDetails id={selected.id} />}
      {selected.kind === 'workstation' && <WorkstationDetails id={selected.id} />}
      {selected.kind === 'agent' && <AgentDetails id={selected.id} />}
      {selected.kind === 'furniture' && <FurnitureDetails id={selected.id} />}
    </aside>
  )
}
