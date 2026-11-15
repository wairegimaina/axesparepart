import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field, Loading, NativeSelect, PageHeader, useBusy } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMe } from '@/hooks/useAuth'
import { del, get, patch, post } from '@/lib/api'
import { dateTime } from '@/lib/format'
import type { Member, MemberRole } from '@/lib/types'

const ROLE: Record<MemberRole, [string, string]> = {
  owner: ['Owner', 'Everything, including the team'],
  manager: ['Manager', 'Company profile, products and stock'],
  inventory: ['Inventory manager', 'Products and stock'],
  sales: ['Sales', 'View products; handle orders when ordering opens'],
}

export default function Team() {
  const { data: me } = useMe()
  const isOwner = me?.supplier?.member_role === 'owner'
  const qc = useQueryClient()
  const members = useQuery({ queryKey: ['supplier', 'members'], queryFn: () => get<Member[]>('/supplier/members/') })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', role: 'sales' as MemberRole })
  const [busy, run] = useBusy()
  const refresh = () => qc.invalidateQueries({ queryKey: ['supplier', 'members'] })

  return (
    <>
      <PageHeader
        title="Team"
        actions={isOwner && <Button onClick={() => setOpen(true)}><UserPlus /> Add team member</Button>}
      />
      {members.isLoading ? <Loading /> : (
        <div className="overflow-x-auto surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Last sign in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.map((m) => (
                <TableRow key={m.id} className={m.is_active ? undefined : 'opacity-50'}>
                  <TableCell>
                    <p className="font-medium">{m.full_name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </TableCell>
                  <TableCell>
                    {isOwner && m.role !== 'owner' && m.is_active ? (
                      <NativeSelect className="w-44" value={m.role} aria-label="Role" onChange={(e) => run(async () => { await patch(`/supplier/members/${m.id}/`, { role: e.target.value }); refresh() })}>
                        {(['manager', 'inventory', 'sales'] as const).map((r) => <option key={r} value={r}>{ROLE[r][0]}</option>)}
                      </NativeSelect>
                    ) : (
                      <Badge variant="secondary">{ROLE[m.role][0]}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{m.last_login ? dateTime(m.last_login) : 'Never'}</TableCell>
                  <TableCell className="text-right">
                    {isOwner && m.role !== 'owner' && m.is_active && (
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => { await del(`/supplier/members/${m.id}/`); refresh(); toast.success('Access removed') })}>Remove</Button>
                    )}
                    {!m.is_active && <span className="text-xs text-muted-foreground">Removed</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <dl className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
        {Object.values(ROLE).map(([name, desc]) => (
          <div key={name} className="rounded-lg bg-muted/60 px-3 py-2"><dt className="font-medium">{name}</dt><dd className="text-muted-foreground">{desc}</dd></div>
        ))}
      </dl>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Full name" htmlFor="m-name"><Input id="m-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="m-email" ><Input id="m-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Role" htmlFor="m-role">
              <NativeSelect id="m-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as MemberRole })}>
                {(['manager', 'inventory', 'sales'] as const).map((r) => <option key={r} value={r}>{ROLE[r][0]}: {ROLE[r][1]}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !form.email || !form.full_name}
              onClick={() => run(async () => {
                try {
                  await post('/supplier/members/', form)
                  toast.success(`Invitation sent to ${form.email}`)
                  setForm({ full_name: '', email: '', role: 'sales' })
                  setOpen(false)
                  refresh()
                } catch (e) {
                  toast.error((e as Error).message)
                }
              })}
            >
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
