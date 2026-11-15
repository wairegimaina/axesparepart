import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function QuantityInput({ value, onChange, min = 1, max, label = 'Quantity' }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label?: string }) {
  const clamp = (n: number) => Math.max(min, max ? Math.min(max, n) : n)
  return (
    <div className="inline-flex items-center rounded-lg border">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}><Minus /></Button>
      <input
        aria-label={label}
        inputMode="numeric"
        className="w-10 bg-transparent text-center text-sm tabular-nums outline-none"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10)
          onChange(clamp(n || min))
        }}
      />
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Increase" disabled={max !== undefined && value >= max} onClick={() => onChange(clamp(value + 1))}><Plus /></Button>
    </div>
  )
}
