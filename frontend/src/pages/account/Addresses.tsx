import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, Loading, PageHeader } from '@/components/common'
import { AddressFields, emptyAddress, type AddressDraft } from '@/components/AddressForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ApiError, del, get, patch, post } from '@/lib/api'
import type { Address } from '@/lib/types'

export default function Addresses() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['addresses'], queryFn: () => get<Address[]>('/account/addresses/') })
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [draft, setDraft] = useState<AddressDraft>(emptyAddress)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] })
  const open = (a: Address | 'new') => {
    setErrors({})
    setDraft(a === 'new' ? emptyAddress : { label: a.label, recipient_name: a.recipient_name, phone: a.phone, county: a.county, town: a.town, street_address: a.street_address, delivery_notes: a.delivery_notes })
    setEditing(a)
  }
  return (
    <>
      <PageHeader title="Addresses" actions={<Button onClick={() => open('new')}><Plus /> Add address</Button>} />
      {q.isLoading ? <Loading /> : q.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.map((a) => (
            <div key={a.id} className="surface p-4 text-sm">
              <p className="flex items-center gap-2 font-medium">{a.label || a.recipient_name}{a.is_default && <Badge variant="secondary">Default</Badge>}</p>
              <p className="mt-1 text-muted-foreground">{a.recipient_name} · {a.phone}</p>
              <p className="text-muted-foreground">{a.street_address}, {a.town}, {a.county}</p>
              <div className="mt-3 flex gap-1">
                <Button size="sm" variant="outline" onClick={() => open(a)}>Edit</Button>
                {!a.is_default && <Button size="sm" variant="ghost" onClick={async () => { await patch(`/account/addresses/${a.id}/`, { is_default: true }); refresh() }}>Make default</Button>}
                <Button size="sm" variant="ghost" onClick={async () => { await del(`/account/addresses/${a.id}/`); refresh(); toast.success('Address removed') }}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState title="No saved addresses" description="Addresses you use at checkout are saved here." />}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing === 'new' ? 'Add address' : 'Edit address'}</DialogTitle></DialogHeader>
          <AddressFields value={draft} onChange={setDraft} errors={errors} />
          <DialogFooter>
            <Button
              onClick={async () => {
                try {
                  if (editing === 'new') await post('/account/addresses/', draft)
                  else if (editing) await patch(`/account/addresses/${editing.id}/`, draft)
                  refresh()
                  setEditing(null)
                } catch (e) {
                  if (e instanceof ApiError) setErrors(e.fields)
                }
              }}
            >
              Save address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
