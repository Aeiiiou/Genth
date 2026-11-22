import { create } from 'zustand'

export type SelectionKind = 'room' | 'workstation' | 'furniture' | 'agent'
export interface Selection {
  kind: SelectionKind
  id: string
}

export type AgentTone = 'ok' | 'busy' | 'waiting' | 'error'

const INITIAL_STATUS: OfficeState['agentStatus'] = {
  supervisor: { text: 'All ok', tone: 'ok' },
  github: { text: 'Waiting for 2 PM run', tone: 'waiting' },
  summary: { text: 'Idle', tone: 'waiting' },
  war: { text: 'Nothing to file', tone: 'waiting' },
}

export type Connection = 'connecting' | 'live' | 'offline'

export interface RunState {
  id: number | null
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  step: string | null
}

export interface FeedItem {
  id: number
  agentId: string | null
  type: string
  message: string
  at: string
  warning?: boolean
}

const FEED_LIMIT = 40
const SPEECH_MS = 5000

export const selectionKey = (s: Selection) => `${s.kind}:${s.id}`

interface OfficeState {
  selected: Selection | null
  hovered: string | null
  select: (s: Selection | null) => void
  hover: (key: string | null) => void

  /** Quarter turns from the default view. Unbounded so each turn animates the short way. */
  viewIndex: number
  zoomCommand: { factor: number; nonce: number }
  resetNonce: number
  rotate: (dir: 1 | -1) => void
  zoomBy: (factor: number) => void
  resetView: () => void

  /** Short status line shown above each agent. Phase 2 drives this from backend events. */
  agentStatus: Record<string, { text: string; tone: AgentTone }>
  setAgentStatus: (agentId: string, text: string, tone?: AgentTone) => void

  /** Live link to the backend. */
  connection: Connection
  setConnection: (c: Connection) => void
  run: RunState | null
  setRun: (run: RunState | null) => void
  /** Recent events, newest first. */
  feed: FeedItem[]
  addToFeed: (items: FeedItem[]) => void

  /** Bumped whenever a summary is drafted or reviewed, so review views refetch. */
  reviewVersion: number
  bumpReviews: () => void
  /** Summary batch open in the review panel. */
  reviewing: number | null
  openReview: (batchId: number | null) => void

  /** What each agent is saying right now (speech bubble), with when it disappears. */
  speech: Record<string, { text: string; until: number }>
  speak: (agentId: string, text: string, ms?: number) => void

  /** Floor shown in the cutaway view; floors above it are hidden. */
  focusFloor: number
  setFocusFloor: (floor: number) => void
  /** Switch floors automatically to keep the selected agent in view. */
  follow: boolean
  setFollow: (on: boolean) => void
}

export const useOfficeStore = create<OfficeState>()((set) => ({
  selected: null,
  hovered: null,
  select: (selected) => set({ selected }),
  hover: (hovered) => set({ hovered }),

  viewIndex: 0,
  zoomCommand: { factor: 1, nonce: 0 },
  resetNonce: 0,
  rotate: (dir) => set((s) => ({ viewIndex: s.viewIndex + dir })),
  zoomBy: (factor) => set((s) => ({ zoomCommand: { factor, nonce: s.zoomCommand.nonce + 1 } })),
  resetView: () =>
    set((s) => ({ viewIndex: Math.round(s.viewIndex / 4) * 4, resetNonce: s.resetNonce + 1 })),

  agentStatus: INITIAL_STATUS,
  setAgentStatus: (agentId, text, tone = 'busy') =>
    set((s) => ({ agentStatus: { ...s.agentStatus, [agentId]: { text, tone } } })),

  connection: 'connecting',
  setConnection: (connection) => set({ connection }),
  run: null,
  setRun: (run) => set({ run }),
  reviewVersion: 0,
  bumpReviews: () => set((s) => ({ reviewVersion: s.reviewVersion + 1 })),
  reviewing: null,
  openReview: (reviewing) => set({ reviewing }),
  speech: {},
  speak: (agentId, text, ms = SPEECH_MS) => {
    const until = Date.now() + ms
    set((s) => ({ speech: { ...s.speech, [agentId]: { text, until } } }))
    // Clear it when it expires, unless the agent has said something newer since.
    setTimeout(() => {
      set((s) => {
        if (s.speech[agentId]?.until !== until) return s
        const rest = { ...s.speech }
        delete rest[agentId]
        return { speech: rest }
      })
    }, ms)
  },
  focusFloor: 1,
  setFocusFloor: (focusFloor) => set({ focusFloor }),
  follow: true,
  setFollow: (follow) => set({ follow }),
  feed: [],
  addToFeed: (items) =>
    set((s) => {
      const seen = new Set(s.feed.map((f) => f.id))
      const fresh = items.filter((i) => !seen.has(i.id))
      if (!fresh.length) return s
      return { feed: [...fresh, ...s.feed].sort((a, b) => b.id - a.id).slice(0, FEED_LIMIT) }
    }),
}))
