import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, post } from '@/lib/api'
import type { Me } from '@/lib/types'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<Me>('/auth/me/')
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return async () => {
    await post('/auth/logout/')
    qc.clear()
    qc.setQueryData(['me'], null)
  }
}

export function homeFor(me: Me | null | undefined) {
  if (!me) return '/'
  if (me.role === 'admin') return '/admin'
  if (me.supplier) return '/supplier'
  return '/'
}

/** A same-site path from ?next=, or null (never an off-site URL). */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}
