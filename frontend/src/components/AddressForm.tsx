import { useQuery } from '@tanstack/react-query'
import { Field, NativeSelect } from '@/components/common'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { get } from '@/lib/api'
import type { County } from '@/lib/types'

export function useCounties() {
  return useQuery({ queryKey: ['counties'], queryFn: () => get<County[]>('/delivery/counties/'), staleTime: 5 * 60_000 })
}

export interface AddressDraft {
  label: string
  recipient_name: string
  phone: string
  county: string
  town: string
  street_address: string
  delivery_notes: string
}

export const emptyAddress: AddressDraft = { label: '', recipient_name: '', phone: '', county: '', town: '', street_address: '', delivery_notes: '' }

const OTHER = '__other__'

export function AddressFields({ value, onChange, errors = {} }: { value: AddressDraft; onChange: (v: AddressDraft) => void; errors?: Record<string, string> }) {
  const set = (k: keyof AddressDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value })
  const counties = useCounties()
  const towns = counties.data?.find((c) => c.county === value.county)?.towns ?? []
  // "Other" lets customers type a place that isn't in the list.
  const [other, setOther] = useState(false)
  const typing = other || (value.town !== '' && !towns.includes(value.town)) || (!!value.county && !towns.length)
  const pickTown = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const t = e.target.value
    setOther(t === OTHER)
    onChange({ ...value, town: t === OTHER ? '' : t })
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Recipient name" htmlFor="ad-name" required error={errors.recipient_name}><Input id="ad-name" autoComplete="name" value={value.recipient_name} onChange={set('recipient_name')} /></Field>
      <Field label="Phone" htmlFor="ad-phone" required error={errors.phone} ><Input id="ad-phone" type="tel" autoComplete="tel" placeholder="+254…" value={value.phone} onChange={set('phone')} /></Field>
      <Field label="County" htmlFor="ad-county" required error={errors.county}>
        <NativeSelect id="ad-county" value={value.county} onChange={(e) => { setOther(false); onChange({ ...value, county: e.target.value, town: '' }) }}>
          <option value="">Choose county</option>
          {counties.data?.map((c) => (
            <option key={c.county} value={c.county} disabled={!c.available}>
              {c.county}{c.available ? '' : ' · not available'}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Town / area" htmlFor="ad-town" required error={errors.town}>
        <div className="grid gap-2">
          {!!towns.length && (
            <NativeSelect id={typing ? undefined : 'ad-town'} value={typing ? OTHER : value.town} onChange={pickTown} aria-label="Town">
              <option value="">Choose town</option>
              {towns.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value={OTHER}>Other – type my area</option>
            </NativeSelect>
          )}
          {!value.county && <NativeSelect id="ad-town" disabled value=""><option value="">Choose county first</option></NativeSelect>}
          {value.county && typing && (
            <Input id="ad-town" autoFocus={other} placeholder="Type your town, estate or village" value={value.town} onChange={set('town')} />
          )}
        </div>
      </Field>
      <Field label="Street, building or landmark" htmlFor="ad-street" required error={errors.street_address} className="sm:col-span-2"><Input id="ad-street" autoComplete="street-address" value={value.street_address} onChange={set('street_address')} /></Field>
      <Field label="Delivery notes" htmlFor="ad-notes" error={errors.delivery_notes}><Input id="ad-notes" placeholder="e.g. Gate 2, ask for the workshop manager" value={value.delivery_notes} onChange={set('delivery_notes')} /></Field>
      <Field label="Save as" htmlFor="ad-label" error={errors.label}><Input id="ad-label" placeholder="e.g. Workshop" value={value.label} onChange={set('label')} /></Field>
    </div>
  )
}
