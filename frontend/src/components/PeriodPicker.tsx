import { Download } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { NativeSelect } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function presetRange(p: string): [string, string] {
  const today = new Date()
  const back = (days: number) => { const d = new Date(today); d.setDate(d.getDate() - days + 1); return iso(d) }
  switch (p) {
    case '7': return [back(7), iso(today)]
    case '90': return [back(90), iso(today)]
    case 'month': return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)]
    case 'lastmonth': return [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))]
    case 'year': return [iso(new Date(today.getFullYear(), 0, 1)), iso(today)]
    default: return [back(30), iso(today)]
  }
}

/** Period kept in the URL (?period=30 or ?from=&to=) so a report can be shared or bookmarked. */
export function usePeriod() {
  const [params, setParams] = useSearchParams()
  const preset = params.get('from') ? 'custom' : (params.get('period') ?? '30')
  const [from, to] = preset === 'custom' ? [params.get('from')!, params.get('to') ?? iso(new Date())] : presetRange(preset)
  const set = (next: Record<string, string | null>) => {
    const n = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) { if (v === null) n.delete(k); else n.set(k, v) }
    setParams(n, { replace: true })
  }
  return { from, to, preset, set, query: `from=${from}&to=${to}` }
}

export function PeriodPicker({ period, csvHref }: { period: ReturnType<typeof usePeriod>; csvHref?: string }) {
  const { preset, from, to, set } = period
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect className="w-40" value={preset} aria-label="Period"
        onChange={(e) => e.target.value === 'custom' ? set({ period: null, from, to }) : set({ period: e.target.value, from: null, to: null })}>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="month">This month</option>
        <option value="lastmonth">Last month</option>
        <option value="year">This year</option>
        <option value="custom">Custom dates</option>
      </NativeSelect>
      {preset === 'custom' && (
        <>
          <Input type="date" className="w-36" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} aria-label="From" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" className="w-36" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} aria-label="To" />
        </>
      )}
      {csvHref && <Button variant="outline" size="sm" render={<a href={csvHref} download />}><Download /> CSV</Button>}
    </div>
  )
}
