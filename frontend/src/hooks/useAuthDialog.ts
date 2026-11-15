import { create } from 'zustand'

export type AuthMode = 'login' | 'register' | 'forgot'

interface AuthDialogState {
  mode: AuthMode | null
  /** Where to go once signed in (e.g. /checkout). Without it the shopper stays on the page they were on. */
  next: string | null
  open: (mode: AuthMode, next?: string) => void
  setMode: (mode: AuthMode) => void
  close: () => void
}

/** Sign in / create account open as an overlay over the current page instead of navigating away. */
export const useAuthDialog = create<AuthDialogState>((set) => ({
  mode: null,
  next: null,
  open: (mode, next) => set({ mode, next: next ?? null }),
  setMode: (mode) => set({ mode }),
  close: () => set({ mode: null, next: null }),
}))
