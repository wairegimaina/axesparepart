import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, CheckCircle2, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, Field, Loading, PageHeader, Pager, useBusy } from '@/components/common'
import { PaymentPill, StatusPill } from '@/components/OrderStatus'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMe } from '@/hooks/useAuth'
import { ApiError, del, get, patch, qs } from '@/lib/api'
import { date, dateTime, money } from '@/lib/format'
import type { Address, AdminOrderSummary, Paginated } from '@/lib/types'

interface CustomerRow { id: number; full_name: string; email: string; phone: string; is_active: boolean; date_joined: string; order_count: number; spent: string }

export function AdminCustomers() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['admin', 'customers', page, search], queryFn: () => get<Paginated<CustomerRow>>(`/admin/customers/${qs({ page, search })}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Customers" />
      <Input className="mb-4 w-full sm:w-72" placeholder="Name, email or phone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} aria-label="Search customers" />
      {q.isLoading ? <Loading /> : q.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead className="hidden text-right sm:table-cell">Orders</TableHead><TableHead className="text-right">Spent</TableHead><TableHead className="hidden md:table-cell">Joined</TableHead></TableRow></TableHeader>
            <TableBody>
              {q.data.results.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/admin/customers/${c.id}`)}>
                  <TableCell><p className="font-medium">{c.full_name}{!c.is_active && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Deactivated</span>}</p><p className="text-xs text-muted-foreground">{c.email}</p><p className="text-xs text-muted-foreground sm:hidden">{c.order_count} order{c.order_count === 1 ? '' : 's'}</p></TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{c.phone || '—'}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{c.order_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.spent)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{date(c.date_joined)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="No customers yet" />}
      {q.data && <Pager page={page} count={q.data.count} onPage={setPage} />}
    </>
  )
}

interface CustomerDetail {
  id: number; full_name: string; email: string; phone: string; is_active: boolean; date_joined: string; last_login: string | null
  addresses: Address[]; orders: AdminOrderSummary[]; can_delete: boolean
}

function EditCustomer({ c, onClose, onSaved }: { c: CustomerDetail; onClose: () => void; onSaved: (c: CustomerDetail) => void }) {
  const [v, setV] = useState({ full_name: c.full_name, email: c.email, phone: c.phone })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, run] = useBusy()
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit customer</DialogTitle></DialogHeader>
        <form id="edit-customer" className="grid gap-4" onSubmit={(e) => {
          e.preventDefault()
          run(async () => {
            try {
              onSaved(await patch<CustomerDetail>(`/admin/customers/${c.id}/`, v))
              toast.success('Customer updated')
            } catch (err) {
              if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields)
              else toast.error((err as Error).message)
            }
          })
        }}>
          <Field label="Full name" htmlFor="c-name" error={errors.full_name}><Input id="c-name" value={v.full_name} onChange={set('full_name')} required /></Field>
          <Field label="Email" htmlFor="c-email" error={errors.email} hint="They sign in with this email.">
            <Input id="c-email" type="email" value={v.email} onChange={set('email')} required />
          </Field>
          <Field label="Phone" htmlFor="c-phone" error={errors.phone}><Input id="c-phone" type="tel" placeholder="+254…" value={v.phone} onChange={set('phone')} /></Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="edit-customer" disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteCustomer({ c, onClose, onDeleted }: { c: CustomerDetail; onClose: () => void; onDeleted: () => void }) {
  const [busy, run] = useBusy()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete {c.full_name}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          This removes the account, saved addresses and notifications for <b className="text-foreground">{c.email}</b>. It can't be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={() => run(async () => {
            try { await del(`/admin/customers/${c.id}/`); toast.success('Customer deleted'); onDeleted() }
            catch (err) { toast.error((err as Error).message) }
          })}><Trash2 /> Delete customer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AdminCustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fullAdmin = useMe().data?.admin_scope !== 'orders'
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const [busy, run] = useBusy()
  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => get<CustomerDetail>(`/admin/customers/${id}/`) })
  if (!q.data) return <Loading />
  const c = q.data
  const saved = (next: CustomerDetail) => {
    qc.setQueryData(['admin', 'customer', id], next)
    qc.invalidateQueries({ queryKey: ['admin', 'customers'] })
    setDialog(null)
  }
  const toggleActive = () => run(async () => {
    try {
      saved(await patch<CustomerDetail>(`/admin/customers/${c.id}/`, { is_active: !c.is_active }))
      toast.success(c.is_active ? 'Account deactivated. They can no longer sign in.' : 'Account reactivated')
    } catch (err) { toast.error((err as Error).message) }
  })
  return (
    <>
      <Link to="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Customers</Link>
      <PageHeader
        title={c.full_name}
        description={<>{!c.is_active && <span className="mr-2 rounded bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">Deactivated</span>}{`${c.email} · ${c.phone || 'no phone'} · joined ${date(c.date_joined)} · last sign in ${dateTime(c.last_login)}`}</>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog('edit')}><Pencil /> Edit</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={toggleActive}>
              {c.is_active ? <><Ban /> Deactivate</> : <><CheckCircle2 /> Reactivate</>}
            </Button>
            {fullAdmin && (
              <Button variant="destructive" size="sm" disabled={!c.can_delete} onClick={() => setDialog('delete')}
                title={c.can_delete ? undefined : 'Customers with orders or help requests are kept. Deactivate instead.'}>
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        }
      />
      {fullAdmin && !c.can_delete && (
        <p className="mb-4 text-xs text-muted-foreground">This customer has orders or help requests, so they can't be deleted. Deactivate the account to stop them signing in.</p>
      )}
      {dialog === 'edit' && <EditCustomer c={c} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog === 'delete' && <DeleteCustomer c={c} onClose={() => setDialog(null)} onDeleted={() => {
        qc.invalidateQueries({ queryKey: ['admin', 'customers'] })
        navigate('/admin/customers')
      }} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader><TableRow><TableHead>Order</TableHead><TableHead className="hidden sm:table-cell">Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="hidden sm:table-cell">Placed</TableHead></TableRow></TableHeader>
            <TableBody>
              {c.orders.map((o) => (
                <TableRow key={o.number} className="cursor-pointer" onClick={() => navigate(`/admin/orders/${o.number}`)}>
                  <TableCell>
                    <p className="font-mono whitespace-nowrap">{o.number}</p>
                    <div className="mt-1 flex flex-wrap gap-1 sm:hidden"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell"><div className="flex flex-wrap gap-1"><StatusPill status={o.status} label={o.status_display} /><PaymentPill status={o.payment_status} /></div></TableCell>
                  <TableCell className="text-right tabular-nums">{money(o.total)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{date(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!c.orders.length && <p className="p-4 text-sm text-muted-foreground">No orders.</p>}
        </div>
        <aside className="grid content-start gap-3">
          {c.addresses.map((a) => (
            <div key={a.id} className="surface p-3 text-sm">
              <p className="font-medium">{a.label || a.recipient_name}</p>
              <p className="text-muted-foreground">{a.phone}</p>
              <p className="text-muted-foreground">{a.street_address}, {a.town}, {a.county}</p>
            </div>
          ))}
        </aside>
      </div>
    </>
  )
}
