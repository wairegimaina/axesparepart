import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Banknote } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, Field, Loading, NativeSelect, PageHeader, useBusy } from '@/components/common'
import { PeriodPicker, usePeriod } from '@/components/PeriodPicker'
import { Statement, type StatementData } from '@/components/Statement'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { get, post } from '@/lib/api'
import { money } from '@/lib/format'

interface Balances { suppliers: { supplier_id: number; name: string; earned: string; paid: string; balance: string; bank_details: string }[]; total_owed: string }

/** List of suppliers with what we owe them. Rendered inside Admin → Payments. */
export function PayoutBalances() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['admin', 'payout-balances'], queryFn: () => get<Balances>('/admin/payouts/') })
  if (!q.data) return <Loading />
  if (!q.data.suppliers.length) return <EmptyState title="Nothing owed to suppliers yet" description="Amounts appear once you collect parts from a supplier." />
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>Owed to suppliers: <span className="font-semibold">{money(q.data.total_owed)}</span></p>
        <Button variant="outline" size="sm" render={<a href="/api/admin/payouts/?export=csv" download />}>CSV</Button>
      </div>
      <div className="overflow-x-auto surface">
        <Table>
          <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="hidden text-right sm:table-cell">Earned</TableHead><TableHead className="hidden text-right sm:table-cell">Paid</TableHead><TableHead className="text-right">Owed</TableHead></TableRow></TableHeader>
          <TableBody>
            {q.data.suppliers.map((s) => (
              <TableRow key={s.supplier_id} className="cursor-pointer" onClick={() => navigate(`/admin/payouts/${s.supplier_id}`)}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(s.earned)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(s.paid)}</TableCell>
                <TableCell className={`text-right font-medium tabular-nums ${Number(s.balance) > 0 ? '' : 'text-muted-foreground'}`}>{money(s.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

export default function AdminSupplierStatement() {
  const { id } = useParams()
  const qc = useQueryClient()
  const period = usePeriod()
  const q = useQuery({ queryKey: ['admin', 'statement', id, period.query], queryFn: () => get<StatementData>(`/admin/payouts/${id}/?${period.query}`), placeholderData: (p) => p })
  const balances = useQuery({ queryKey: ['admin', 'payout-balances'], queryFn: () => get<Balances>('/admin/payouts/') })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ amount: '', method: 'bank_transfer', reference: '', note: '' })
  const [busy, run] = useBusy()
  if (!q.data) return <Loading />
  const d = q.data
  const bank = balances.data?.suppliers.find((s) => String(s.supplier_id) === id)?.bank_details
  return (
    <>
      <Link to="/admin/payments?tab=payouts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Supplier payouts</Link>
      <PageHeader title={d.supplier.name} description="Supplier statement"
        actions={<Button onClick={() => { setForm({ ...form, amount: Number(d.current_balance) > 0 ? d.current_balance : '' }); setOpen(true) }}><Banknote /> Record payout</Button>} />
      <div className="mb-6"><PeriodPicker period={period} csvHref={`/api/admin/payouts/${id}/?${period.query}&export=csv`} /></div>
      <Statement data={d} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payout</DialogTitle><DialogDescription>Owed now: {money(d.current_balance)}</DialogDescription></DialogHeader>
          {bank ? <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-line">{bank}</p> : <p className="text-sm text-muted-foreground">This supplier hasn't added payout details yet.</p>}
          <Field label="Amount paid (KES)" htmlFor="po-amt"><Input id="po-amt" type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Method" htmlFor="po-method">
            <NativeSelect id="po-method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option>
            </NativeSelect>
          </Field>
          <Field label="Reference" htmlFor="po-ref"><Input id="po-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <Field label="Note" htmlFor="po-note"><Input id="po-note" placeholder="e.g. Orders up to 15 Nov" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <DialogFooter>
            <Button disabled={busy || !Number(form.amount)} onClick={() => run(async () => {
              try {
                qc.setQueryData(['admin', 'statement', id, period.query], await post<StatementData>(`/admin/payouts/${id}/?${period.query}`, form))
                qc.invalidateQueries({ queryKey: ['admin', 'payout-balances'] })
                qc.invalidateQueries({ queryKey: ['admin', 'report'] })
                setOpen(false); toast.success('Payout recorded, supplier notified')
              } catch (e) { toast.error((e as Error).message) }
            })}>Record payout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
