import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ErrorNote, Field, NativeSelect, useBusy } from '@/components/common'
import { useCounties } from '@/components/AddressForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, get, post } from '@/lib/api'
import type { BusinessCategory } from '@/lib/types'
import { cn } from '@/lib/utils'

const blank = {
  company_name: '', business_phone: '', business_email: '', county: '', town: '', physical_address: '',
  registration_number: '', tax_pin: '', owner_name: '', owner_email: '', owner_phone: '',
  business_category_ids: [] as number[],
}

/** Admins onboard suppliers. The owner gets an email to set their password and sign in. */
export function AddSupplierButton() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, run] = useBusy()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const counties = useCounties()
  const types = useQuery({ queryKey: ['business-categories'], queryFn: () => get<BusinessCategory[]>('/business-categories/'), enabled: open })
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value })
  const text = (k: keyof typeof blank, label: string, opts: { required?: boolean; type?: string; placeholder?: string; wide?: boolean; hint?: string } = {}) => (
    <Field label={label} htmlFor={`ns-${k}`} required={opts.required} error={errors[k]} hint={opts.hint} className={opts.wide ? 'sm:col-span-2' : undefined}>
      <Input id={`ns-${k}`} type={opts.type} placeholder={opts.placeholder} value={form[k] as string} onChange={set(k)} />
    </Field>
  )
  const toggle = (id: number) => setForm({ ...form, business_category_ids: form.business_category_ids.includes(id) ? form.business_category_ids.filter((x) => x !== id) : [...form.business_category_ids, id] })

  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus /> Add supplier</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add supplier</DialogTitle>
            <DialogDescription>The owner gets an email to set a password and sign in.</DialogDescription>
          </DialogHeader>
          <form
            id="add-supplier"
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              run(async () => {
                setErrors({}); setError('')
                try {
                  const s = await post<{ id: number; name: string }>('/admin/suppliers/', form)
                  qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] })
                  toast.success(`${s.name} added. Invite sent to ${form.owner_email}`)
                  setOpen(false); setForm(blank)
                  navigate(`/admin/suppliers/${s.id}`)
                } catch (err) {
                  if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields)
                  else setError((err as Error).message)
                }
              })
            }}
          >
            <ErrorNote error={error} />
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Company</legend>
              {text('company_name', 'Company name', { required: true, wide: true })}
              {text('business_phone', 'Business phone', { required: true, type: 'tel', placeholder: '+254…' })}
              {text('business_email', 'Business email', { type: 'email' })}
              <Field label="County" htmlFor="ns-county" required error={errors.county}>
                <NativeSelect id="ns-county" value={form.county} onChange={set('county')}>
                  <option value="">Choose county</option>
                  {counties.data?.map((c) => <option key={c.county} value={c.county}>{c.county}</option>)}
                </NativeSelect>
              </Field>
              {text('town', 'Town')}
              {text('physical_address', 'Shop address', { placeholder: 'e.g. Kirinyaga Road, Shop 12', wide: true })}
              {text('registration_number', 'Registration number')}
              {text('tax_pin', 'KRA PIN')}
              <div className="grid gap-2 sm:col-span-2">
                <p className="text-sm font-medium">What they sell</p>
                <div className="flex flex-wrap gap-2">
                  {types.data?.map((t) => (
                    <button key={t.id} type="button" onClick={() => toggle(t.id)}
                      className={cn('rounded-full border px-3 py-1 text-sm transition', form.business_category_ids.includes(t.id) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50')}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Owner login</legend>
              {text('owner_name', 'Full name', { required: true })}
              {text('owner_phone', 'Phone', { type: 'tel', placeholder: '+254…' })}
              {text('owner_email', 'Email', { required: true, type: 'email', wide: true, hint: 'If a customer already signed up with this email, their account becomes the supplier login. They keep their password.' })}
            </fieldset>
          </form>
          <DialogFooter>
            <Button type="submit" form="add-supplier"
              disabled={busy || !form.company_name.trim() || !form.business_phone.trim() || !form.county || !form.owner_name.trim() || !form.owner_email.trim()}>
              {busy ? 'Adding…' : 'Add supplier and send invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
