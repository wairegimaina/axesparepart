import { BadgeCheck, ImagePlus, Loader2, PackageOpen, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { ListingStatus, SupplierStatus } from '@/lib/types'

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl leading-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  accepted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  active: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  suspended: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  archived: 'bg-muted text-muted-foreground line-through',
  inactive: 'bg-muted text-muted-foreground',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending approval', approved: 'Published', rejected: 'Rejected', archived: 'Archived',
  accepted: 'Accepted', suspended: 'Suspended', active: 'Active', inactive: 'Inactive',
}

export function StatusBadge({ status, label }: { status: ListingStatus | SupplierStatus | string; label?: string }) {
  return <Badge className={cn('border-0', STATUS_STYLE[status])}>{label ?? STATUS_LABEL[status] ?? status}</Badge>
}

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  const label = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended' }[status]
  return <StatusBadge status={status} label={label} />
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-400', className)}>
      <BadgeCheck className="size-4" /> Verified Supplier
    </span>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><PackageOpen className="size-7" /></span>
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  return <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>
}

export function Field({
  label, error, hint, children, className, htmlFor, required,
}: {
  label: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; required?: boolean
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'space-y-3 text-sm leading-relaxed [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc',
        className,
      )}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  )
}

export function FileButton({
  onFile, onFiles, multiple, accept, label = 'Upload', busy, variant = 'outline', icon = 'upload',
}: {
  accept: string; label?: string; busy?: boolean
  variant?: 'outline' | 'default' | 'secondary'; icon?: 'upload' | 'image'
} & (
  | { multiple?: false; onFile: (f: File) => void | Promise<void>; onFiles?: never }
  | { multiple: true; onFiles: (files: File[]) => void | Promise<void>; onFile?: never }
)) {
  const ref = useRef<HTMLInputElement>(null)
  const Icon = icon === 'image' ? ImagePlus : Upload
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (!files.length) return
          if (multiple) await onFiles?.(files)
          else await onFile?.(files[0])
        }}
      />
      <Button type="button" variant={variant} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Icon />} {label}
      </Button>
    </>
  )
}

export function Pager({ page, count, pageSize = 24, onPage }: { page: number; count: number; pageSize?: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages <= 1) return null
  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-muted-foreground">Page {page} of {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  )
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' }) {
  return (
    <div className={cn('surface h-full p-4 transition hover:-translate-y-px', tone === 'warn' && 'bg-amber-50 ring-1 ring-amber-300/80 dark:bg-amber-500/10 dark:ring-amber-500/40')}>
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="figure mt-1 text-3xl leading-none">{value}</p>
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function useBusy() {
  const [busy, setBusy] = useState(false)
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true)
    try {
      return await fn()
    } finally {
      setBusy(false)
    }
  }
  return [busy, run] as const
}
