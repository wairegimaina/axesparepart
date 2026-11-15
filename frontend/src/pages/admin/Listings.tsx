import { useQuery } from '@tanstack/react-query'
import { Wrench } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager, StatusBadge } from '@/components/common'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get, qs } from '@/lib/api'
import { CONDITION_LABEL, dateTime, money } from '@/lib/format'
import type { AdminListing, Paginated } from '@/lib/types'

export default function AdminListings() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? 'pending'
  const page = Number(params.get('page') ?? 1)
  const [search, setSearch] = useState('')
  const offers = status === 'offers'
  const q = { status: status === 'all' || offers ? '' : status, deal_status: offers ? 'pending' : '', page, search, supplier: params.get('supplier') }
  const list = useQuery({ queryKey: ['admin', 'listings', q], queryFn: () => get<Paginated<AdminListing>>(`/admin/listings/${qs(q)}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Product approvals" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setParams(v === 'pending' ? {} : { status: String(v) })}>
          <TabsList>
            {[['pending', 'Pending'], ['offers', 'Offers to approve'], ['approved', 'Published'], ['rejected', 'Rejected'], ['draft', 'Drafts'], ['all', 'All']].map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <Input className="ml-auto w-full sm:w-64" placeholder="Product, part no., supplier" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search listings" />
      </div>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="hidden md:table-cell">Supplier</TableHead>
                <TableHead className="hidden sm:table-cell">Condition</TableHead>
                <TableHead className="text-right">Supplier price</TableHead>
                <TableHead className="text-right">Customer price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((l) => {
                const img = l.product.images[0]?.url ?? l.images[0]?.url
                return (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => navigate(`/admin/listings/${l.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {img ? <img src={img} alt="" className="h-full w-full object-contain" /> : <Wrench className="size-4 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0">
                          <p className="max-w-56 truncate font-medium">{l.product.name}</p>
                          <p className="text-xs text-muted-foreground">{l.product.brand.name}{l.product.part_number && ` · ${l.product.part_number}`}{l.product.status === 'pending' && ' · new to catalogue'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{l.supplier.name}</TableCell>
                    <TableCell className="hidden sm:table-cell">{CONDITION_LABEL[l.condition]}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.supplier_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.customer_price)}{l.price_override && <span className="ml-1 text-xs text-muted-foreground">(set)</span>}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                      {l.deal && l.deal.status !== 'ended' && l.deal.status !== 'rejected' && (
                        <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${l.deal.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : 'bg-red-600 text-white'}`}>
                          −{l.deal.percent}%{l.deal.status === 'pending' && ' to approve'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{dateTime(l.submitted_at)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title={status === 'pending' ? 'Nothing waiting for approval' : 'No listings here'} />}
      {list.data && <Pager page={page} count={list.data.count} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }} />}
    </>
  )
}
