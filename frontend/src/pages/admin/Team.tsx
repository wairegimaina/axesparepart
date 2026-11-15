import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorNote, Field, Loading, NativeSelect, PageHeader, useBusy } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useMe } from '@/hooks/useAuth'
import { get, patch, post } from '@/lib/api'
import { dateTime } from '@/lib/format'

type Scope = 'full' | 'orders'
interface Member {
  id: number
  email: string
  full_name: string
  phone: string
  admin_scope: Scope
  is_active: boolean
  last_login: string | null
  date_joined: string
}

const SCOPE: Record<Scope, { label: string; hint: string }> = {
  full: { label: 'Full admin', hint: 'Everything, including settings, suppliers, payouts and reports.' },
  orders: { label: 'Orders staff', hint: 'Calls customers and runs orders, deliveries, payments and help requests. Never sees supplier costs.' },
}

function AddMember({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [busy, run] = useBusy()
  const [error, setError] = useState<unknown>(null)
  const [v, setV] = useState({ full_name: '', email: '', phone: '', admin_scope: 'orders' as Scope })
  const save = () => run(async () => {
    setError(null)
    try {
      await post('/admin/team/', v)
      qc.invalidateQueries({ queryKey: ['admin', 'team'] })
      toast.success(`Invite sent to ${v.email}`)
      onClose()
    } catch (e) {
      setError(e)
    }
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
          <DialogDescription>They get an email to set their password.</DialogDescription>
        </DialogHeader>
        <ErrorNote error={error} />
        <Field label="Full name" htmlFor="t-name"><Input id="t-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label="Email" htmlFor="t-email"><Input id="t-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="t-phone"><Input id="t-phone" type="tel" placeholder="+254…" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Access" htmlFor="t-scope" hint={SCOPE[v.admin_scope].hint}>
          <NativeSelect id="t-scope" value={v.admin_scope} onChange={(e) => setV({ ...v, admin_scope: e.target.value as Scope })}>
            <option value="orders">{SCOPE.orders.label}</option>
            <option value="full">{SCOPE.full.label}</option>
          </NativeSelect>
        </Field>
        <DialogFooter>
          <Button disabled={busy || !v.full_name.trim() || !v.email.trim()} onClick={save}><MailPlus /> Add and send invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Team() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const list = useQuery({ queryKey: ['admin', 'team'], queryFn: () => get<Member[]>('/admin/team/') })
  const [adding, setAdding] = useState(false)
  const [busy, run] = useBusy()

  const change = (m: Member, body: Partial<Member>, message: string) => run(async () => {
    try {
      await patch(`/admin/team/${m.id}/`, body)
      qc.invalidateQueries({ queryKey: ['admin', 'team'] })
      toast.success(message)
    } catch (e) {
      toast.error((e as Error).message)
    }
  })
  const resend = (m: Member) => run(async () => {
    try {
      await post(`/admin/team/${m.id}/resend-invite/`)
      toast.success(`Invite sent to ${m.email}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  })

  const actions = (m: Member, align: string) => (
    <div className={`flex gap-1 ${align}`}>
      {!m.last_login && m.is_active && <Button size="sm" variant="ghost" disabled={busy} onClick={() => resend(m)}>Resend invite</Button>}
      <Button size="sm" variant="outline" disabled={busy}
        onClick={() => change(m, { is_active: !m.is_active }, m.is_active ? `${m.full_name} can no longer sign in` : `${m.full_name} can sign in again`)}>
        {m.is_active ? 'Disable' : 'Enable'}
      </Button>
    </div>
  )

  return (
    <>
      <PageHeader
        title="Team"
        description="People who run the marketplace. Give callers Orders staff access."
        actions={<Button onClick={() => setAdding(true)}><UserPlus /> Add team member</Button>}
      />
      {list.isLoading ? <Loading /> : (
        <div className="surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="hidden md:table-cell">Last signed in</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.map((m) => {
                const self = m.id === me?.id
                return (
                  <TableRow key={m.id} className={m.is_active ? '' : 'opacity-60'}>
                    <TableCell>
                      <p className="font-medium">{m.full_name}{self && <span className="text-muted-foreground"> (you)</span>}</p>
                      <p className="text-xs break-all text-muted-foreground">{m.email}{m.phone && ` · ${m.phone}`}</p>
                      {!self && <div className="mt-2 sm:hidden">{actions(m, '')}</div>}
                    </TableCell>
                    <TableCell>
                      {self ? <Badge variant="secondary">{SCOPE[m.admin_scope].label}</Badge> : (
                        <NativeSelect className="h-8 w-32 text-sm sm:w-40" value={m.admin_scope} disabled={busy} aria-label={`Access for ${m.full_name}`}
                          onChange={(e) => change(m, { admin_scope: e.target.value as Scope }, `${m.full_name} is now ${SCOPE[e.target.value as Scope].label.toLowerCase()}`)}>
                          <option value="orders">{SCOPE.orders.label}</option>
                          <option value="full">{SCOPE.full.label}</option>
                        </NativeSelect>
                      )}
                      {!m.is_active && <Badge variant="outline" className="mt-1">Disabled</Badge>}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{m.last_login ? dateTime(m.last_login) : 'Not yet'}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      {!self && actions(m, 'justify-end')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {adding && <AddMember onClose={() => setAdding(false)} />}
    </>
  )
}
