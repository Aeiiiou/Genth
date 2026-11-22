import { create } from 'zustand'

export type SelectionKind = 'room' | 'workstation' | 'furniture' | 'agent'
export interface Selection {
  kind: SelectionKind
  id: string
}

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
}))
