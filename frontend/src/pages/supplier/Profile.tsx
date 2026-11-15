import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Download, FileText, Lock, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ErrorNote, Field, FileButton, Loading, Markdown, NativeSelect, PageHeader, StatusBadge, useBusy,
} from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/hooks/useAuth'
import { del, get, patch, upload } from '@/lib/api'
import { applyApiErrors } from '@/lib/forms'
import { bytes, date } from '@/lib/format'
import type { BusinessCategory, SupplierDocument, SupplierProfile } from '@/lib/types'
import { canEditProfile } from './SupplierLayout'

const TABS = ['info', 'about', 'images', 'categories', 'documents'] as const
type Tab = (typeof TABS)[number]

function useProfile() {
  return useQuery({ queryKey: ['supplier', 'profile'], queryFn: () => get<SupplierProfile>('/supplier/profile/') })
}

function useSaveProfile() {
  const qc = useQueryClient()
  return async (values: Partial<SupplierProfile> & { business_category_ids?: number[] }) => {
    const data = await patch<SupplierProfile>('/supplier/profile/', values)
    qc.setQueryData(['supplier', 'profile'], data)
    qc.invalidateQueries({ queryKey: ['supplier', 'dashboard'] })
    qc.invalidateQueries({ queryKey: ['me'] })
    toast.success('Saved')
    return data
  }
}

function InfoForm({ profile, readOnly }: { profile: SupplierProfile; readOnly: boolean }) {
  const save = useSaveProfile()
  const [error, setError] = useState('')
  const locked = profile.status === 'approved'
  const fields = [
    'name', 'tagline', 'year_established', 'registration_number', 'tax_pin', 'business_email', 'business_phone',
    'website', 'county', 'town', 'physical_address', 'business_hours', 'payout_details',
  ] as const
  const form = useForm({ defaultValues: Object.fromEntries(fields.map((f) => [f, profile[f] ?? ''])) as Record<(typeof fields)[number], string> })
  const { errors, isSubmitting, isDirty } = form.formState
  const lockIcon = locked ? <Lock className="inline size-3" /> : null

  return (
    <form
      className="grid gap-6"
      onSubmit={form.handleSubmit(async (v) => {
        setError('')
        try {
          const payload: Record<string, unknown> = { ...v, year_established: v.year_established ? Number(v.year_established) : null }
          if (locked) for (const f of ['name', 'registration_number', 'tax_pin']) delete payload[f]
          const saved = await save(payload as Partial<SupplierProfile>)
          form.reset(Object.fromEntries(fields.map((f) => [f, saved[f] ?? ''])) as Record<(typeof fields)[number], string>)
        } catch (e) {
          setError(applyApiErrors(e, form.setError, [...fields]))
        }
      })}
    >
      <ErrorNote error={error} />
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Public details</legend>
        <Field label="Company name" htmlFor="name" error={errors.name?.message} hint={locked ? <>{lockIcon} Locked after approval. Contact us to change it.</> : undefined}>
          <Input id="name" disabled={locked} {...form.register('name')} />
        </Field>
        <Field label="Tagline" htmlFor="tagline" error={errors.tagline?.message} hint="e.g. Boxer, TVS and Haojin spares">
          <Input id="tagline" maxLength={160} {...form.register('tagline')} />
        </Field>
        <Field label="Year established" htmlFor="year_established" error={errors.year_established?.message}>
          <Input id="year_established" type="number" inputMode="numeric" {...form.register('year_established')} />
        </Field>
        <Field label="Business hours" htmlFor="business_hours" error={errors.business_hours?.message} hint="e.g. Mon–Fri 8am–5pm, Sat 9am–1pm">
          <Input id="business_hours" {...form.register('business_hours')} />
        </Field>
        <Field label="County" htmlFor="county" error={errors.county?.message}>
          <Input id="county" {...form.register('county')} />
        </Field>
        <Field label="Town" htmlFor="town" error={errors.town?.message}>
          <Input id="town" {...form.register('town')} />
        </Field>
      </fieldset>
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-semibold">Private details</legend>
        <p className="mb-2 text-xs text-muted-foreground sm:col-span-2">
          Private. Customers don't see these.
        </p>
        <Field label="Business registration number" htmlFor="registration_number" error={errors.registration_number?.message}>
          <Input id="registration_number" disabled={locked} {...form.register('registration_number')} />
        </Field>
        <Field label="KRA PIN" htmlFor="tax_pin" error={errors.tax_pin?.message}>
          <Input id="tax_pin" disabled={locked} {...form.register('tax_pin')} />
        </Field>
        <Field label="Business email" htmlFor="business_email" error={errors.business_email?.message}>
          <Input id="business_email" type="email" {...form.register('business_email')} />
        </Field>
        <Field label="Business phone" htmlFor="business_phone" error={errors.business_phone?.message}>
          <Input id="business_phone" type="tel" {...form.register('business_phone')} />
        </Field>
        <Field label="Website" htmlFor="website" error={errors.website?.message}>
          <Input id="website" type="url" placeholder="https://" {...form.register('website')} />
        </Field>
        <Field label="Physical address" htmlFor="physical_address" error={errors.physical_address?.message}>
          <Input id="physical_address" {...form.register('physical_address')} />
        </Field>
        <Field label="Payout details" htmlFor="payout_details" error={errors.payout_details?.message} hint="Bank, account name and number we pay you to" className="sm:col-span-2">
          <Textarea id="payout_details" rows={3} {...form.register('payout_details')} />
        </Field>
      </fieldset>
      {!readOnly && (
        <div>
          <Button type="submit" disabled={isSubmitting || !isDirty}>Save changes</Button>
        </div>
      )}
    </form>
  )
}

function AboutForm({ profile, readOnly }: { profile: SupplierProfile; readOnly: boolean }) {
  const save = useSaveProfile()
  const [preview, setPreview] = useState(false)
  const form = useForm({
    defaultValues: {
      description: profile.description, brands_distributed: profile.brands_distributed, warranty_policy: profile.warranty_policy,
    },
  })
  const description = form.watch('description')
  return (
    <form
      className="grid gap-5"
      onSubmit={form.handleSubmit(async (v) => {
        try {
          const saved = await save(v)
          form.reset({ description: saved.description, brands_distributed: saved.brands_distributed, warranty_policy: saved.warranty_policy })
        } catch (e) {
          toast.error(applyApiErrors(e, form.setError) || 'Check the form')
        }
      })}
    >
      <fieldset disabled={readOnly} className="grid gap-5">
        <Field
          label="About the company"
          htmlFor="description"
          hint="What you sell and your experience."
        >
          <div className="mb-1 flex gap-1">
            <Button type="button" size="xs" variant={preview ? 'ghost' : 'secondary'} onClick={() => setPreview(false)}>Write</Button>
            <Button type="button" size="xs" variant={preview ? 'secondary' : 'ghost'} onClick={() => setPreview(true)}>Preview</Button>
          </div>
          {preview ? (
            <div className="min-h-48 rounded-lg border p-3">{description ? <Markdown>{description}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview.</p>}</div>
          ) : (
            <Textarea id="description" rows={10} {...form.register('description')} />
          )}
        </Field>
        <Field label="Brands you distribute" htmlFor="brands_distributed" hint="e.g. Bajaj, TVS, Haojin">
          <Input id="brands_distributed" {...form.register('brands_distributed')} />
        </Field>
        <Field label="Warranty & after-sales support" htmlFor="warranty_policy">
          <Textarea id="warranty_policy" rows={4} {...form.register('warranty_policy')} />
        </Field>
      </fieldset>
      {!readOnly && <div><Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>Save changes</Button></div>}
    </form>
  )
}

function ImagesPanel({ profile, readOnly }: { profile: SupplierProfile; readOnly: boolean }) {
  const qc = useQueryClient()
  const [busy, run] = useBusy()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['supplier', 'profile'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }
  const send = (kind: 'logo' | 'cover') => (file: File) =>
    run(async () => {
      try {
        await upload(`/supplier/profile/${kind}/`, file)
        toast.success(kind === 'logo' ? 'Logo updated' : 'Cover image updated')
        refresh()
      } catch (e) {
        toast.error((e as Error).message)
      }
    })
  const remove = (kind: 'logo' | 'cover') => run(async () => { await del(`/supplier/profile/${kind}/`); refresh() })

  return (
    <div className="grid gap-8">
      <div>
        <h3 className="font-medium">Cover image</h3>
        <p className="mb-3 text-sm text-muted-foreground">1600×400 px, up to 5 MB.</p>
        <div className="flex aspect-[4/1] items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-r from-primary/20 to-muted">
          {profile.cover_url && <img src={profile.cover_url} alt="Cover" className="h-full w-full object-cover" />}
        </div>
        {!readOnly && (
          <div className="mt-3 flex gap-2">
            <FileButton accept="image/jpeg,image/png,image/webp" label={profile.cover_url ? 'Replace cover' : 'Upload cover'} onFile={send('cover')} busy={busy} icon="image" />
            {profile.cover_url && <Button variant="ghost" onClick={() => remove('cover')} disabled={busy}>Remove</Button>}
          </div>
        )}
      </div>
      <div>
        <h3 className="font-medium">Logo</h3>
        <p className="mb-3 text-sm text-muted-foreground">Square image, at least 400×400 px.</p>
        <div className="flex items-center gap-4">
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border bg-muted">
            {profile.logo_url ? <img src={profile.logo_url} alt="Logo" className="h-full w-full object-cover" /> : <Building2 className="size-8 text-muted-foreground" />}
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              <FileButton accept="image/jpeg,image/png,image/webp" label={profile.logo_url ? 'Replace logo' : 'Upload logo'} onFile={send('logo')} busy={busy} icon="image" />
              {profile.logo_url && <Button variant="ghost" onClick={() => remove('logo')} disabled={busy}>Remove</Button>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CategoriesPanel({ profile, readOnly }: { profile: SupplierProfile; readOnly: boolean }) {
  const save = useSaveProfile()
  const cats = useQuery({ queryKey: ['business-categories'], queryFn: () => get<BusinessCategory[]>('/business-categories/') })
  const [selected, setSelected] = useState<number[]>(profile.business_categories.map((c) => c.id))
  useEffect(() => setSelected(profile.business_categories.map((c) => c.id)), [profile])
  const [busy, run] = useBusy()
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Choose what your business sells.</p>
      <div className="flex flex-wrap gap-2">
        {cats.data?.map((c) => {
          const on = selected.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              disabled={readOnly}
              aria-pressed={on}
              onClick={() => setSelected(on ? selected.filter((x) => x !== c.id) : [...selected, c.id])}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {c.name}
            </button>
          )
        })}
      </div>
      {!readOnly && (
        <div>
          <Button disabled={busy} onClick={() => run(() => save({ business_category_ids: selected }))}>Save categories</Button>
        </div>
      )}
    </div>
  )
}

const DOC_TYPES = [
  ['registration', 'Business registration certificate'],
  ['tax', 'Tax registration (KRA PIN)'],
  ['distribution', 'Distribution authorization'],
  ['other', 'Other supporting document'],
] as const

function DocumentsPanel({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient()
  const docs = useQuery({ queryKey: ['supplier', 'documents'], queryFn: () => get<SupplierDocument[]>('/supplier/documents/') })
  const [docType, setDocType] = useState<string>('registration')
  const [title, setTitle] = useState('')
  const [busy, run] = useBusy()
  const remove = useMutation({
    mutationFn: (id: number) => del(`/supplier/documents/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier', 'documents'] }),
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <div className="grid gap-6">
      <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" />
        Private. PDF, JPG or PNG up to 10 MB.
      </p>
      {!readOnly && (
        <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Document type" htmlFor="doc_type">
            <NativeSelect id="doc_type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Description (optional)" htmlFor="doc_title">
            <Input id="doc_title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bosch dealer letter 2026" />
          </Field>
          <FileButton
            accept="application/pdf,image/jpeg,image/png"
            label="Choose file"
            variant="default"
            busy={busy}
            onFile={(f) =>
              run(async () => {
                try {
                  await upload('/supplier/documents/', f, { doc_type: docType, title })
                  setTitle('')
                  toast.success('Document uploaded')
                  qc.invalidateQueries({ queryKey: ['supplier', 'documents'] })
                  qc.invalidateQueries({ queryKey: ['supplier', 'dashboard'] })
                } catch (e) {
                  toast.error((e as Error).message)
                }
              })
            }
          />
        </div>
      )}
      {docs.isLoading ? (
        <Loading />
      ) : docs.data?.length ? (
        <ul className="divide-y rounded-xl border">
          {docs.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 p-3">
              <FileText className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{d.doc_type_display}{d.title && <span className="font-normal text-muted-foreground"> · {d.title}</span>}</p>
                <p className="truncate text-xs text-muted-foreground">{d.original_name} · {bytes(d.size_bytes)} · {date(d.created_at)}</p>
                {d.review_note && <p className="mt-1 text-xs text-destructive">{d.review_note}</p>}
              </div>
              <StatusBadge status={d.status} label={{ pending: 'Awaiting review', accepted: 'Accepted', rejected: 'Not accepted' }[d.status]} />
              <Button variant="ghost" size="icon-sm" render={<a href={`/api/supplier/documents/${d.id}/download/`} target="_blank" rel="noreferrer" aria-label="Open" />}>
                <Download />
              </Button>
              {!readOnly && d.status !== 'accepted' && (
                <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove.mutate(d.id)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
      )}
    </div>
  )
}

export default function Profile() {
  const { data: me } = useMe()
  const { data: profile, isLoading } = useProfile()
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'info'
  const readOnly = !canEditProfile(me)

  if (isLoading || !profile) return <Loading />
  return (
    <>
      <PageHeader
        title="Company profile"
        description={readOnly ? 'Only the owner or a manager can edit the company profile.' : 'Your company details. Customers never see these.'}
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: String(v) })}>
        <TabsList>
          <TabsTrigger value="info">Company information</TabsTrigger>
          <TabsTrigger value="about">About us</TabsTrigger>
          <TabsTrigger value="images">Logo & cover</TabsTrigger>
          <TabsTrigger value="categories">What you sell</TabsTrigger>
          <TabsTrigger value="documents">Verification documents</TabsTrigger>
        </TabsList>
        <div className="mt-4 surface p-5">
          <TabsContent value="info"><InfoForm key={profile.reviewed_at ?? 'p'} profile={profile} readOnly={readOnly} /></TabsContent>
          <TabsContent value="about"><AboutForm profile={profile} readOnly={readOnly} /></TabsContent>
          <TabsContent value="images"><ImagesPanel profile={profile} readOnly={readOnly} /></TabsContent>
          <TabsContent value="categories"><CategoriesPanel profile={profile} readOnly={readOnly} /></TabsContent>
          <TabsContent value="documents"><DocumentsPanel readOnly={readOnly} /></TabsContent>
        </div>
      </Tabs>
    </>
  )
}
