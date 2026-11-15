import { useQueryClient } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '@/components/layout/Logo'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { homeFor, safeNext } from '@/hooks/useAuth'
import { useAuthDialog, type AuthMode } from '@/hooks/useAuthDialog'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ForgotForm, LoginForm, RegisterForm } from '@/pages/public/Auth'

const COPY: Record<AuthMode, { title: string; subtitle: string }> = {
  login: { title: 'Welcome back', subtitle: 'Sign in to check out and track your orders.' },
  register: { title: 'Create your account', subtitle: 'Order genuine parts and track every delivery.' },
  forgot: { title: 'Reset your password', subtitle: "Enter your email and we'll send you a reset link." },
}

/**
 * Sign in / create account as an overlay, so shoppers keep their place on the page.
 * Mounted once at the app root; open it with useAuthDialog().open('login').
 */
export function AuthDialog() {
  const { mode, next, setMode, close } = useAuthDialog()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const signedIn = (me: Me) => {
    qc.setQueryData(['me'], me)
    close()
    // Shoppers stay where they were; staff and suppliers go to their portal.
    const target = safeNext(next) ?? (homeFor(me) !== '/' ? homeFor(me) : null)
    if (target) navigate(target)
  }

  const shown = mode ?? 'login'
  const link = 'font-medium text-primary hover:underline'

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md">
        <div className="brand-cover relative px-6 pt-6 pb-5 text-brand-foreground">
          <DialogClose className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close">
            <XIcon className="size-4" />
          </DialogClose>
          <Logo />
          <DialogTitle className="mt-5 text-2xl leading-tight font-bold">{COPY[shown].title}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-white/75">{COPY[shown].subtitle}</DialogDescription>
        </div>

        {shown !== 'forgot' && (
          <div className="mx-6 mt-5 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm font-medium" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={shown === m}
                onClick={() => setMode(m)}
                className={cn('rounded-md py-1.5 transition', shown === m ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
        )}

        <div className="p-6">
          {shown === 'login' && (
            <LoginForm
              key="login"
              onSignedIn={signedIn}
              forgot={<button type="button" className="hover:text-foreground" onClick={() => setMode('forgot')}>Forgot your password?</button>}
            />
          )}
          {shown === 'register' && <RegisterForm key="register" onSignedIn={signedIn} />}
          {shown === 'forgot' && (
            <ForgotForm key="forgot" back={<button type="button" className={link} onClick={() => setMode('login')}>Back to sign in</button>} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
