import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface CartLine {
  listing_id: number
  quantity: number
}

interface CartState {
  lines: CartLine[]
  add: (listing_id: number, quantity: number) => void
  setQuantity: (listing_id: number, quantity: number) => void
  remove: (listing_id: number) => void
  clear: () => void
}

// localStorage can be unavailable (private mode, blocked storage); fall back to memory.
const safeStorage = createJSONStorage(() => {
  try {
    const k = '__axe_test__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return localStorage
  } catch {
    const mem = new Map<string, string>()
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }
  }
})

/** The cart only stores what and how many. Prices always come from the server quote. */
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (listing_id, quantity) =>
        set((s) => {
          const existing = s.lines.find((l) => l.listing_id === listing_id)
          return {
            lines: existing
              ? s.lines.map((l) => (l.listing_id === listing_id ? { ...l, quantity: l.quantity + quantity } : l))
              : [...s.lines, { listing_id, quantity }],
          }
        }),
      setQuantity: (listing_id, quantity) =>
        set((s) => ({ lines: s.lines.map((l) => (l.listing_id === listing_id ? { ...l, quantity: Math.max(1, quantity) } : l)) })),
      remove: (listing_id) => set((s) => ({ lines: s.lines.filter((l) => l.listing_id !== listing_id) })),
      clear: () => set({ lines: [] }),
    }),
    { name: 'axe-cart', storage: safeStorage },
  ),
)

export const useCartCount = () => useCart((s) => s.lines.reduce((n, l) => n + l.quantity, 0))
