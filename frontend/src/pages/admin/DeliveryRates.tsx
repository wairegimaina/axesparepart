import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { NativeSelect, useBusy } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCounties } from '@/components/AddressForm'
import { del, get, patch, post } from '@/lib/api'
import { money } from '@/lib/format'
import type { DeliveryRate } from '@/lib/types'

const blank = { county: '', fee: '', days_min: '1', days_max: '3' }

/** Per-county delivery fee and time. Counties not listed use the standard fee. */
export function DeliveryRates({ standardFee }: { standardFee: string }) {
  const qc = useQueryClient()
  const rates = useQuery({ queryKey: ['admin', 'delivery-rates'], queryFn: () => get<DeliveryRate[]>('/admin/delivery-rates/') })
  const counties = useCounties()
  const [draft, setDraft] = useState(blank)
  const [busy, run] = useBusy()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'delivery-rates'] })
    qc.invalidateQueries({ queryKey: ['counties'] })
  }
  const save = (fn: () => Promise<unknown>, msg: string) =>
    run(async () => {
      try { await fn(); refresh(); toast.success(msg) } catch (e) { toast.error((e as Error).message) }
    })
  const used = new Set(rates.data?.map((r) => r.county))

  return (
    <section className="grid max-w-2xl gap-4 surface p-5">
      <div>
        <h2 className="font-semibold">Delivery by county</h2>
        <p className="text-sm text-muted-foreground">Other counties: {money(standardFee)}.</p>
      </div>
      {!!rates.data?.length && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>County</TableHead><TableHead>Fee (KES)</TableHead><TableHead>Days</TableHead><TableHead>Delivering</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {rates.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.county}</TableCell>
                  <TableCell>
                    <Input className="h-7 w-24" type="number" min="0" defaultValue={Number(r.fee)} aria-label={`${r.county} fee`}
                      onBlur={(e) => Number(e.target.value) !== Number(r.fee) && save(() => patch(`/admin/delivery-rates/${r.id}/`, { fee: e.target.value || '0' }), `${r.county} updated`)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input className="h-7 w-14" type="number" min="0" defaultValue={r.days_min} aria-label={`${r.county} minimum days`}
                        onBlur={(e) => Number(e.target.value) !== r.days_min && save(() => patch(`/admin/delivery-rates/${r.id}/`, { days_min: Number(e.target.value) }), `${r.county} updated`)} />
                      –
                      <Input className="h-7 w-14" type="number" min="0" defaultValue={r.days_max} aria-label={`${r.county} maximum days`}
                        onBlur={(e) => Number(e.target.value) !== r.days_max && save(() => patch(`/admin/delivery-rates/${r.id}/`, { days_max: Number(e.target.value) }), `${r.county} updated`)} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <input type="checkbox" className="size-4 accent-primary" checked={r.is_active} disabled={busy} aria-label={`Deliver to ${r.county}`}
                      onChange={(e) => save(() => patch(`/admin/delivery-rates/${r.id}/`, { is_active: e.target.checked }), e.target.checked ? `Delivering to ${r.county}` : `Stopped delivering to ${r.county}`)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${r.county}`} disabled={busy} onClick={() => save(() => del(`/admin/delivery-rates/${r.id}/`), `${r.county} uses the standard fee`)}><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_110px_70px_70px_auto] sm:items-end">
        <label className="grid gap-1 text-xs font-medium">County
          <NativeSelect value={draft.county} onChange={(e) => setDraft({ ...draft, county: e.target.value })}>
            <option value="">Choose county</option>
            {counties.data?.filter((c) => !used.has(c.county)).map((c) => <option key={c.county} value={c.county}>{c.county}</option>)}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs font-medium">Fee (KES)<Input type="number" min="0" value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} /></label>
        <label className="grid gap-1 text-xs font-medium">Min days<Input type="number" min="0" value={draft.days_min} onChange={(e) => setDraft({ ...draft, days_min: e.target.value })} /></label>
        <label className="grid gap-1 text-xs font-medium">Max days<Input type="number" min="0" value={draft.days_max} onChange={(e) => setDraft({ ...draft, days_max: e.target.value })} /></label>
        <Button disabled={busy || !draft.county || draft.fee === ''}
          onClick={() => save(async () => { await post('/admin/delivery-rates/', { ...draft, days_min: Number(draft.days_min), days_max: Number(draft.days_max) }); setDraft(blank) }, `${draft.county} added`)}>
          Add
        </Button>
      </div>
    </section>
  )
}
