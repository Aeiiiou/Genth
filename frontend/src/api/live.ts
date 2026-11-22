/**
 * Live link to the backend: a WebSocket that streams agent events into the office.
 * Reconnects with backoff; every (re)connect starts with a snapshot, so state never drifts.
 */
import type { SpotName } from '../office/layout/types'
import { useAgentMotion } from '../state/agentMotion'
import { type AgentTone, type FeedItem, type RunState, useOfficeStore } from '../state/officeStore'
import { api, type ServerEvent } from './client'

interface Snapshot {
  type: 'snapshot'
  agents: Record<string, { status: { text: string; tone: AgentTone }; spot: SpotName }>
  run: RunState | null
}

const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 10000

function toFeed(e: ServerEvent): FeedItem | null {
  const message = e.payload.message
  if (typeof message !== 'string') return null
  return { id: e.id, agentId: e.agentId, type: e.type, message, at: e.createdAt, warning: Boolean(e.payload.warning) }
}

function applySnapshot(s: Snapshot) {
  const office = useOfficeStore.getState()
  const motion = useAgentMotion.getState()
  for (const [id, a] of Object.entries(s.agents)) {
    office.setAgentStatus(id, a.status.text, a.status.tone)
    if (motion.motions[id]?.spot !== a.spot) motion.moveTo(id, a.spot)
  }
  office.setRun(s.run)
}

function applyEvent(e: ServerEvent) {
  const office = useOfficeStore.getState()
  const p = e.payload
  switch (e.type) {
    case 'agent.status':
      if (e.agentId) office.setAgentStatus(e.agentId, String(p.text), (p.tone as AgentTone) ?? 'busy')
      break
    case 'agent.move':
      if (e.agentId) useAgentMotion.getState().moveTo(e.agentId, p.spot as SpotName)
      break
    case 'agent.speech':
      if (e.agentId) office.speak(e.agentId, String(p.text ?? p.message ?? ''))
      break
    case 'summary.ready':
    case 'summary.approved':
    case 'summary.rejected':
      office.bumpReviews()
      break
    case 'run.started':
      office.setRun({ id: e.runId, status: 'running', step: p.message ?? null })
      break
    case 'run.step':
      office.setRun({ id: e.runId, status: 'running', step: p.message ?? null })
      break
    case 'run.completed':
    case 'run.failed':
    case 'run.interrupted':
      office.setRun({ id: e.runId, status: e.type.slice(4) as RunState['status'], step: p.message ?? null })
      break
  }
  const item = toFeed(e)
  if (item) office.addToFeed([item])
}

/** Opens the live connection. Returns a function that closes it for good. */
export function connectLive(): () => void {
  let socket: WebSocket | null = null
  let retryMs = RETRY_MIN_MS
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const office = useOfficeStore.getState()

  const open = () => {
    office.setConnection('connecting')
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${scheme}://${location.host}/api/ws`)

    socket.onopen = () => {
      retryMs = RETRY_MIN_MS
      office.setConnection('live')
      api
        .recentEvents()
        .then((events) => office.addToFeed(events.map(toFeed).filter((f): f is FeedItem => f !== null)))
        .catch(() => {})
    }
    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data as string)
      if (data.type === 'snapshot') applySnapshot(data as Snapshot)
      else applyEvent(data as ServerEvent)
    }
    socket.onclose = () => {
      socket = null
      if (stopped) return
      office.setConnection('offline')
      retryTimer = setTimeout(open, retryMs)
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
    }
  }

  open()
  return () => {
    stopped = true
    clearTimeout(retryTimer)
    socket?.close()
  }
}
