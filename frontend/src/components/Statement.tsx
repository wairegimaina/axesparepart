import { EmptyState, StatCard } from '@/components/common'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { date, dateTime, money } from '@/lib/format'

export interface StatementData {
  from: string
  to: string
  supplier: { id: number; name: string }
  opening_balance: string
  earned: string
  paid: string
  closing_balance: string
  current_balance: string
  earnings: { number: string; collected_at: string; units: number; amount: string }[]
  payouts: { id: number; amount: string; method: string; reference: string; note: string; paid_at: string }[]
}

/** Supplier statement: what they earned (collected orders) and what was paid out, in a period. */
export function Statement({ data, orderLink }: { data: StatementData; orderLink?: (n: string) => string }) {
  const lines = [
    ...data.earnings.map((e) => ({ at: e.collected_at, key: `e${e.number}`, label: `Order ${e.number}`, href: orderLink?.(e.number), detail: `${e.units} unit${e.units === 1 ? '' : 's'} collected`, earned: e.amount })),
    ...data.payouts.map((p) => ({ at: p.paid_at, key: `p${p.id}`, label: 'Payout', href: undefined, detail: [p.method, p.reference, p.note].filter(Boolean).join(' · '), paid: p.amount })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Owed now" value={money(data.current_balance)} tone={Number(data.current_balance) > 0 ? 'warn' : undefined} />
        <StatCard label="Earned in period" value={money(data.earned)} hint={`${data.earnings.length} order${data.earnings.length === 1 ? '' : 's'}`} />
        <StatCard label="Paid in period" value={money(data.paid)} hint={`${data.payouts.length} payout${data.payouts.length === 1 ? '' : 's'}`} />
        <StatCard label="Balance at end" value={money(data.closing_balance)} hint={`Opening ${money(data.opening_balance)}`} />
      </div>
      <div className="mt-6 overflow-x-auto surface">
        {lines.length ? (
          <Table>
            <TableHeader><TableRow><TableHead className="hidden sm:table-cell">Date</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Earned</TableHead><TableHead className="text-right">Paid out</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{date(data.from)}</TableCell><TableCell className="text-muted-foreground">Opening balance</TableCell><TableCell colSpan={2} className="text-right tabular-nums">{money(data.opening_balance)}</TableCell></TableRow>
              {lines.map((l) => (
                <TableRow key={l.key}>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{dateTime(l.at)}</TableCell>
                  <TableCell>{l.href ? <a href={l.href} className="font-medium hover:underline">{l.label}</a> : <span className="font-medium">{l.label}</span>}<p className="text-xs text-muted-foreground">{l.detail}</p><p className="text-xs text-muted-foreground sm:hidden">{dateTime(l.at)}</p></TableCell>
                  <TableCell className="text-right tabular-nums">{'earned' in l ? money(l.earned) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{'paid' in l ? money(l.paid) : ''}</TableCell>
                </TableRow>
              ))}
              <TableRow><TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{date(data.to)}</TableCell><TableCell className="font-semibold">Balance at end</TableCell><TableCell colSpan={2} className="text-right font-semibold tabular-nums">{money(data.closing_balance)}</TableCell></TableRow>
            </TableBody>
          </Table>
        ) : <EmptyState title="Nothing in this period" />}
      </div>
    </>
  )
}
