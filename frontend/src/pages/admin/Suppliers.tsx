import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Loading, PageHeader, Pager, SupplierStatusBadge, VerifiedBadge } from '@/components/common'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { get, qs } from '@/lib/api'
import { date } from '@/lib/format'
import type { Paginated, SupplierStatus } from '@/lib/types'
import { AddSupplierButton } from './AddSupplier'

interface Row {
  id: number
  name: string
  status: SupplierStatus
  is_verified: boolean
  county: string
  town: string
  business_phone: string
  owner_email: string | null
  document_count: number
  pending_documents: number
  created_at: string
}

export default function AdminSuppliers() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const status = params.get('status') ?? ''
  const page = Number(params.get('page') ?? 1)
  const [search, setSearch] = useState('')
  const q = { status, page, search }
  const list = useQuery({ queryKey: ['admin', 'suppliers', q], queryFn: () => get<Paginated<Row>>(`/admin/suppliers/${qs(q)}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Suppliers" actions={<AddSupplierButton />} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(v) => setParams(v ? { status: String(v) } : {})}>
          <TabsList>
            {[['', 'All'], ['approved', 'Active'], ['suspended', 'Suspended']].map(([v, l]) => (
              <TabsTrigger key={v} value={v}>{l}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input className="ml-auto w-full sm:w-64" placeholder="Name, email, phone, reg. no." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search suppliers" />
      </div>
      {list.isLoading ? <Loading /> : list.data?.results.length ? (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="hidden sm:table-cell">Location</TableHead>
                <TableHead className="hidden sm:table-cell">Documents</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.results.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/admin/suppliers/${s.id}`)}>
                  <TableCell><p className="font-medium">{s.name}</p>{s.is_verified && <VerifiedBadge />}{s.pending_documents > 0 && <p className="text-xs text-amber-700 sm:hidden dark:text-amber-400">{s.pending_documents} document{s.pending_documents === 1 ? '' : 's'} to check</p>}</TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{s.owner_email}<p className="text-xs text-muted-foreground">{s.business_phone}</p></TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{[s.town, s.county].filter(Boolean).join(', ')}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">{s.document_count}{s.pending_documents > 0 && <span className="ml-1 text-amber-700 dark:text-amber-400">({s.pending_documents} to check)</span>}</TableCell>
                  <TableCell><SupplierStatusBadge status={s.status} /></TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{date(s.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState title="No suppliers here" />}
      {list.data && <Pager page={page} count={list.data.count} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n) }} />}
    </>
  )
}
