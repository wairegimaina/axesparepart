import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { ErrorNote, Field } from '@/components/common'
import { GoogleButton } from '@/components/GoogleButton'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { homeFor } from '@/hooks/useAuth'
import { post } from '@/lib/api'
import { applyApiErrors } from '@/lib/forms'
import type { Me } from '@/lib/types'
import { cn } from '@/lib/utils'

function AuthShell({ title, subtitle, children, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-start justify-center px-4 py-12">
      <div className={cn('surface w-full overflow-hidden', wide ? 'max-w-3xl' : 'max-w-4xl md:grid md:grid-cols-[1fr_1.1fr]')}>
        {!wide && (
          <div className="brand-cover relative hidden flex-col justify-between p-8 text-brand-foreground md:flex">
            <Logo size="lg" />
            <div>
              <p className="text-4xl leading-none font-bold uppercase italic" style={{ fontFamily: 'var(--font-heading)' }}>Genuine spares.<br /><span className="text-highlight">Delivered.</span></p>
              <p className="mt-3 max-w-56 text-sm text-white/75">Genuine motorbike parts, delivered across Kenya.</p>
            </div>
          </div>
        )}
        <div className="p-6 sm:p-8">
          {wide && <div className="mb-6"><Logo tile /></div>}
          <h1 className="text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

function useSignedIn() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (me: Me) => {
    qc.setQueryData(['me'], me)
    const next = params.get('next')
    navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(me), { replace: true })
  }
}

const loginSchema = z.object({ email: z.email('Enter a valid email'), password: z.string().min(1, 'Enter your password') })

export function Login() {
  const signedIn = useSignedIn()
  const [params] = useSearchParams()
  const next = params.get('next')
  const keepNext = next ? `?next=${encodeURIComponent(next)}` : ''
  const [error, setError] = useState('')
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const { errors, isSubmitting } = form.formState
  return (
    <AuthShell title="Sign in" subtitle={<>New here? <Link to={`/register${keepNext}`} className="text-primary hover:underline">Create an account</Link></>}>
      <GoogleButton text="signin_with" onSignedIn={signedIn} onError={setError} />
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError('')
          try {
            signedIn(await post<Me>('/auth/login/', v))
          } catch (e) {
            setError(applyApiErrors(e, form.setError))
          }
        })}
      >
        <ErrorNote error={error} />
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <Button type="submit" disabled={isSubmitting}>Sign in</Button>
        <Link to="/forgot-password" className="text-center text-sm text-muted-foreground hover:text-foreground">Forgot your password?</Link>
      </form>
    </AuthShell>
  )
}

const password = z.string().min(8, 'Use at least 8 characters')
const customerSchema = z.object({
  full_name: z.string().min(2, 'Enter your name'),
  email: z.email('Enter a valid email'),
  phone: z.string().optional(),
  password,
})

export function Register() {
  const signedIn = useSignedIn()
  const [error, setError] = useState('')
  const form = useForm({ resolver: zodResolver(customerSchema), defaultValues: { full_name: '', email: '', phone: '', password: '' } })
  const { errors, isSubmitting } = form.formState
  return (
    <AuthShell
      title="Create your account"
      subtitle={<>Already have one? <Link to="/login" className="text-primary hover:underline">Sign in</Link></>}
    >
      <GoogleButton text="signup_with" onSignedIn={signedIn} onError={setError} />
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError('')
          try {
            signedIn(await post<Me>('/auth/register/customer/', v))
          } catch (e) {
            setError(applyApiErrors(e, form.setError))
          }
        })}
      >
        <ErrorNote error={error} />
        <Field label="Full name" htmlFor="full_name" error={errors.full_name?.message}>
          <Input id="full_name" autoComplete="name" {...form.register('full_name')} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" autoComplete="tel" placeholder="+254…" {...form.register('phone')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Button type="submit" disabled={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  )
}


export function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const form = useForm({ resolver: zodResolver(z.object({ email: z.email('Enter a valid email') })), defaultValues: { email: '' } })
  return (
    <AuthShell title="Reset your password">
      {sent ? (
        <p className="text-sm">Check your inbox for a reset link.</p>
      ) : (
        <form className="grid gap-4" onSubmit={form.handleSubmit(async (v) => { await post('/auth/password/reset/', v); setSent(true) })}>
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" {...form.register('email')} />
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const form = useForm({ resolver: zodResolver(z.object({ new_password: password })), defaultValues: { new_password: '' } })
  return (
    <AuthShell title="Choose a new password">
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit(async (v) => {
          setError('')
          try {
            await post('/auth/password/reset/confirm/', { ...v, uid: params.get('uid'), token: params.get('token') })
            navigate('/login', { replace: true })
          } catch (e) {
            setError(applyApiErrors(e, form.setError, ['new_password']))
          }
        })}
      >
        <ErrorNote error={error} />
        <Field label="New password" htmlFor="new_password" error={form.formState.errors.new_password?.message}>
          <Input id="new_password" type="password" autoComplete="new-password" {...form.register('new_password')} />
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>Save password</Button>
      </form>
    </AuthShell>
  )
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-5xl font-semibold text-primary">404</p>
      <p className="mt-3 text-muted-foreground">We couldn't find that page.</p>
      <Button className="mt-6" render={<Link to="/" />}>Go to the marketplace</Button>
    </div>
  )
}

