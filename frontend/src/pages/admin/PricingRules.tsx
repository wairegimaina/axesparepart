import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Loading, useBusy } from '@/components/common'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { get, patch } from '@/lib/api'
import { money } from '@/lib/format'
import type { Category, Paginated } from '@/lib/types'

interface SupplierRow { id: number; name: string; status: string; markup_share_percent: string }

const pct = (n: number) => `${Number(n.toFixed(2))}%`

/** Same maths as SupplierListing.regular_price / supplier_share on the server. */
function split(price: number, markup: number, share: number, shareMin: number) {
  const customer = Math.round(price * (1 + markup / 100))
  const supplierShare = markup < shareMin ? 0 : Math.max(0, Math.min(Math.round(price * Math.min(share, markup)) / 100, customer - price))
  return { customer, supplierShare, supplier: price + supplierShare, keep: customer - price - supplierShare }
}

/** Markup per category and each supplier's share of it, with a worked example. */
export function PricingRules({ defaultMarkup, shareMin }: { defaultMarkup: string; shareMin: string }) {
  const qc = useQueryClient()
  const cats = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => get<Category[]>('/admin/categories/') })
  const sups = useQuery({
    queryKey: ['admin', 'suppliers', 'shares'],
    queryFn: () => get<Paginated<SupplierRow>>('/admin/suppliers/?status=approved&page_size=200'),
  })
  const [busy, run] = useBusy()
  const [price, setPrice] = useState('1000')
  const [shareInput, setShare] = useState<string | null>(null)

  // Start the example with the share most suppliers have.
  const typicalShare = useMemo(() => {
    const counts = new Map<number, number>()
    for (const s of sups.data?.results ?? []) {
      const n = Number(s.markup_share_percent)
      counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  }, [sups.data])
  const share = shareInput ?? String(typicalShare)

  const save = (fn: () => Promise<unknown>, msg: string, keys: string[][]) =>
    run(async () => {
      try {
        await fn()
        keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }))
        toast.success(msg)
      } catch (e) { toast.error((e as Error).message) }
    })

  const saveMarkup = (c: Category, raw: string) => {
    const value = raw.trim() === '' ? null : raw.trim()
    if ((value ?? null) === (c.markup_percent == null ? null : String(Number(c.markup_percent)))) return
    if (value !== null && !(Number(value) >= 0 && Number(value) <= 500)) { toast.error('Enter a markup from 0 to 500%'); return }
    save(() => patch(`/admin/categories/${c.id}/`, { markup_percent: value }),
      value === null ? `${c.name} now follows ${c.parent ? 'its parent' : 'the default'}` : `${c.name}: ${Number(value)}% markup`,
      [['admin', 'categories'], ['categories']])
  }
  const saveShare = (s: SupplierRow, raw: string) => {
    if (raw.trim() === '' || Number(raw) === Number(s.markup_share_percent)) return
    if (!(Number(raw) >= 0 && Number(raw) <= 100)) { toast.error('Enter a share from 0 to 100%'); return }
    save(() => patch(`/admin/suppliers/${s.id}/`, { markup_share_percent: raw }), `${s.name}: ${Number(raw)}% share. Applies to new orders.`,
      [['admin', 'suppliers'], ['admin', 'supplier', String(s.id)]])
  }

  const list = cats.data ?? []
  const roots = list.filter((c) => !c.parent)
  const kids = (id: number) => list.filter((c) => c.parent === id)
  const ordered = roots.flatMap((r) => [r, ...kids(r.id)])
  const p = Math.max(0, Number(price) || 0)
  const sh = Math.max(0, Number(share) || 0)
  const def = Number(defaultMarkup)
  const min = Number(shareMin)
  const defSplit = split(p, def, sh, min)

  const renderRow = (c: Category, child: boolean) => {
    const m = Number(c.effective_markup_percent ?? def)
    const own = c.markup_percent != null
    const r = split(p, m, sh, min)
    const inheritLabel = c.parent ? 'parent' : 'default'
    return (
      <TableRow key={c.id} className={c.is_active ? '' : 'opacity-60'}>
        <TableCell className={child ? 'pl-8' : 'font-medium'}>
          {child && <span className="mr-1 text-muted-foreground">└</span>}{c.name}
          {!c.is_active && <span className="ml-2 text-xs text-muted-foreground">(hidden)</span>}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <Input
              key={`${c.id}-${c.markup_percent}`} className="h-8 w-20 text-right tabular-nums" type="number" min="0" max="500" step="0.5"
              inputMode="decimal" defaultValue={own ? Number(c.markup_percent) : ''} placeholder={String(m)}
              aria-label={`${c.name} markup %`} disabled={busy}
              onBlur={(e) => saveMarkup(c, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
            <span className="text-sm text-muted-foreground">%</span>
            {!own && <span className="text-xs text-muted-foreground" title={`Uses the ${inheritLabel} markup`}>↑ {inheritLabel}</span>}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">{money(r.customer)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {money(r.supplier)}
          {m < min && <span className="block text-xs text-muted-foreground">no share (under {pct(min)})</span>}
        </TableCell>
        <TableCell className={`text-right font-semibold tabular-nums ${r.keep <= 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
          {r.keep <= 0 && p > 0 && <AlertTriangle className="mr-1 inline size-3.5" aria-label="Nothing left for the marketplace" />}
          {money(r.keep)}
        </TableCell>
      </TableRow>
    )
  }

  const zeroKeep = ordered.filter((c) => c.is_active && split(p, Number(c.effective_markup_percent ?? def), sh, min).keep <= 0 && p > 0)

  return (
    <section className="grid max-w-4xl gap-5 surface p-5">
      <div>
        <h2 className="font-semibold">Markup by category</h2>
        <p className="text-sm text-muted-foreground">
          Customers pay the supplier's price plus the category's markup. The supplier's share is paid out of that markup;
          the rest is what Axe keeps. {min > 0 && <>Below {pct(min)} markup suppliers get no share. </>}Leave a category empty to use its parent's markup, or the default ({pct(def)}).
          Changes save when you leave the box. For one specific item, set its price under Product approvals.
        </p>
      </div>

      <div className="grid gap-4 rounded-lg border bg-muted/40 p-4 sm:grid-cols-[auto_auto_1fr] sm:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Example: supplier's price</span>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">KES</span>
            <Input className="h-8 w-28 tabular-nums" type="number" min="0" step="100" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Supplier share</span>
          <div className="flex items-center gap-1.5">
            <Input className="h-8 w-20 tabular-nums" type="number" min="0" max="100" step="0.5" value={share} onChange={(e) => setShare(e.target.value)} />
            <span className="text-muted-foreground">%</span>
          </div>
        </label>
        <p className="text-sm text-muted-foreground">
          At the default {pct(def)}: customer pays <b className="text-foreground">{money(defSplit.customer)}</b>, supplier
          gets <b className="text-foreground">{money(defSplit.supplier)}</b>, Axe keeps <b className="text-foreground">{money(defSplit.keep)}</b>.
        </p>
      </div>

      {cats.isLoading ? <Loading /> : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Markup</TableHead>
                <TableHead className="text-right">Customer pays</TableHead>
                <TableHead className="text-right">Supplier gets</TableHead>
                <TableHead className="text-right">Axe keeps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roots.flatMap((r) => [renderRow(r, false), ...kids(r.id).map((c) => renderRow(c, true))])}
            </TableBody>
          </Table>
        </div>
      )}

      {zeroKeep.length > 0 && (
        <p className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <span>
            With a {pct(sh)} supplier share, Axe keeps nothing on {zeroKeep.map((c) => c.name).join(', ')}: the share can't be more
            than the markup, so the supplier takes all of it. Raise the markup there, lower the share, or raise "Supplier share
            only from markup of" above.
          </span>
        </p>
      )}

      <div className="grid gap-3 border-t pt-5">
        <div>
          <h3 className="font-semibold">Supplier shares</h3>
          <p className="text-sm text-muted-foreground">
            Paid to the supplier on top of their price, as a % of their price, and never more than the markup on the item.
            {min > 0 && ` Nothing is paid on parts with a markup under ${pct(min)}.`}
            Orders already placed keep the share they were placed with.
          </p>
        </div>
        {sups.isLoading ? <Loading /> : !sups.data?.results.length ? (
          <p className="text-sm text-muted-foreground">No approved suppliers yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Supplier</TableHead><TableHead>Share</TableHead><TableHead className="text-right">On a {money(p)} part at {pct(def)}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {sups.data.results.map((s) => {
                  const r = split(p, def, Number(s.markup_share_percent), min)
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link to={`/admin/suppliers/${s.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                          {s.name}<ExternalLink className="size-3 text-muted-foreground" />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Input
                            key={`${s.id}-${s.markup_share_percent}`} className="h-8 w-20 text-right tabular-nums" type="number" min="0" max="100" step="0.5"
                            inputMode="decimal" defaultValue={Number(s.markup_share_percent)} aria-label={`${s.name} share %`} disabled={busy}
                            onBlur={(e) => saveShare(s, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        supplier gets <b className="text-foreground">{money(r.supplier)}</b> · Axe keeps <b className="text-foreground">{money(r.keep)}</b>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}
