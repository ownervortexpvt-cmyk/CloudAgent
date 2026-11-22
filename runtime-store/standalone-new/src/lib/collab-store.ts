/**
 * v123 — tiny client store for collaboration presence.
 * Kept separate from the main zustand app store so the 6s heartbeat never
 * re-renders the whole dashboard — only components that subscribe here
 * (CollabDialog list, Dashboard avatar stack) re-render.
 */
'use client'

import { create } from 'zustand'

export interface OnlinePeer { userId: string; name: string; color: string; tab: string }

interface CollabState {
  online: OnlinePeer[]
  setOnline: (p: OnlinePeer[]) => void
}

export const useCollabStore = create<CollabState>((set) => ({
  online: [],
  setOnline: (p) => set({ online: p }),
}))

/** Convenience alias so dialogs read presence with a one-liner. */
export const useOnline = () => useCollabStore((s) => s.online)
export const setOnline = (p: OnlinePeer[]) => useCollabStore.getState().setOnline(p)
