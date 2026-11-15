import { useEffect, useRef, useState } from 'react'
import { post } from '@/lib/api'
import type { Me } from '@/lib/types'
import { usePublicConfig } from '@/pages/public/Help'

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup' }): void
  renderButton(el: HTMLElement, o: Record<string, string | number>): void
}
declare global {
  interface Window { google?: { accounts: { id: GoogleId } } }
}

let script: Promise<void> | null = null
function loadGoogle() {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { script = null; reject(new Error('Google sign-in could not load.')) }
    document.head.appendChild(s)
  })
  return script
}

/**
 * "Continue with Google". Renders nothing until an admin sets the Google client ID in Settings.
 * Google gives us a signed ID token; the backend checks it and signs the user in.
 */
export function GoogleButton({ text = 'continue_with', onSignedIn, onError }: {
  text?: 'signin_with' | 'signup_with' | 'continue_with'
  onSignedIn: (me: Me) => void
  onError: (message: string) => void
}) {
  const clientId = usePublicConfig().data?.google_client_id
  const box = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  // The callback is registered once with Google; keep it pointing at the latest props.
  const handlers = useRef({ onSignedIn, onError })
  useEffect(() => { handlers.current = { onSignedIn, onError } })

  useEffect(() => {
    if (!clientId || !box.current) return
    let cancelled = false
    loadGoogle()
      .then(() => {
        const el = box.current
        if (cancelled || !el || !window.google) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: async ({ credential }) => {
            setBusy(true)
            try {
              handlers.current.onSignedIn(await post<Me>('/auth/google/', { credential }))
            } catch (e) {
              handlers.current.onError(e instanceof Error ? e.message : 'Google sign-in failed.')
            } finally {
              setBusy(false)
            }
          },
        })
        el.replaceChildren()
        window.google.accounts.id.renderButton(el, {
          type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text, logo_alignment: 'center',
          width: Math.min(400, Math.max(200, Math.round(el.getBoundingClientRect().width))),
        })
      })
      .catch((e: Error) => handlers.current.onError(e.message))
    return () => { cancelled = true }
  }, [clientId, text])

  if (!clientId) return null
  return (
    <div className="mb-5 grid gap-5">
      <div ref={box} className={busy ? 'pointer-events-none flex h-11 justify-center opacity-60' : 'flex h-11 justify-center'} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" /> or use email <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
