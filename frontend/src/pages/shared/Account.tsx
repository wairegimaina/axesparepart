import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { ErrorNote, Field, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { useMe } from '@/hooks/useAuth'
import { get, patch, post } from '@/lib/api'
import { applyApiErrors } from '@/lib/forms'
import type { Me } from '@/lib/types'

interface EmailPref { group: string; label: string; email: boolean }

function EmailPreferences() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => get<EmailPref[]>('/notifications/preferences/') })
  if (!q.data) return null
  return (
    <section className="grid content-start gap-3 surface p-5 lg:col-span-2">
      <h2 className="font-semibold">Emails</h2>
      {q.data.map((p) => (
        <label key={p.group} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={p.email}
            onChange={async (e) => {
              try {
                qc.setQueryData(['notification-prefs'], await patch<EmailPref[]>('/notifications/preferences/', { [p.group]: e.target.checked }))
                toast.success('Saved')
              } catch (err) { toast.error((err as Error).message) }
            }} />
          {p.label}
        </label>
      ))}
      <p className="text-xs text-muted-foreground">You'll still see every update under Notifications.</p>
    </section>
  )
}

export default function Account() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const profile = useForm({ values: { full_name: me?.full_name ?? '', phone: me?.phone ?? '' } })
  const pw = useForm({ defaultValues: { current_password: '', new_password: '' } })
  const [pwError, setPwError] = useState('')
  return (
    <>
      <PageHeader title="Account settings" description={me?.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form
          className="grid content-start gap-4 surface p-5"
          onSubmit={profile.handleSubmit(async (v) => {
            try {
              qc.setQueryData(['me'], await patch<Me>('/auth/me/', v))
              toast.success('Saved')
            } catch (e) {
              toast.error(applyApiErrors(e, profile.setError) || 'Check the form')
            }
          })}
        >
          <h2 className="font-semibold">Your details</h2>
          <Field label="Full name" htmlFor="a-name" error={profile.formState.errors.full_name?.message}><Input id="a-name" {...profile.register('full_name')} /></Field>
          <Field label="Phone" htmlFor="a-phone" error={profile.formState.errors.phone?.message}><Input id="a-phone" type="tel" {...profile.register('phone')} /></Field>
          <div><Button type="submit" disabled={profile.formState.isSubmitting}>Save</Button></div>
        </form>
        <form
          className="grid content-start gap-4 surface p-5"
          onSubmit={pw.handleSubmit(async (v) => {
            setPwError('')
            try {
              await post('/auth/password/', v)
              pw.reset()
              toast.success('Password changed')
            } catch (e) {
              setPwError(applyApiErrors(e, pw.setError))
            }
          })}
        >
          <h2 className="font-semibold">Change password</h2>
          <ErrorNote error={pwError} />
          <Field label="Current password" htmlFor="a-cur" error={pw.formState.errors.current_password?.message}>
            <PasswordInput id="a-cur" autoComplete="current-password" {...pw.register('current_password', { required: 'Required' })} />
          </Field>
          <Field label="New password" htmlFor="a-new" error={pw.formState.errors.new_password?.message}>
            <PasswordInput id="a-new" autoComplete="new-password" {...pw.register('new_password', { required: 'Required', minLength: { value: 8, message: 'Use at least 8 characters' } })} />
          </Field>
          <div><Button type="submit" disabled={pw.formState.isSubmitting}>Change password</Button></div>
        </form>
        <EmailPreferences />
      </div>
    </>
  )
}
