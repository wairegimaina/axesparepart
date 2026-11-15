import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

/**
 * The client's AXE logo laid out side by side (axe mark, then the AXE word with the tagline as real text) so it
 * stays readable at header height. Drawn for a dark background: on light pages pass `tile`.
 */
const SIZES = {
  sm: { mark: 'h-8', word: 'h-3.5', tag: 'text-[6.5px] tracking-[0.18em]' },
  md: { mark: 'h-9 min-[360px]:h-11', word: 'h-4 min-[360px]:h-5', tag: 'text-[7px] tracking-[0.16em] min-[360px]:text-[8.5px] min-[360px]:tracking-[0.2em]' },
  lg: { mark: 'h-16', word: 'h-7', tag: 'text-[11px] tracking-[0.22em]' },
}

export function Logo({ to = '/', suffix, tile, size = 'md', className }: {
  to?: string; suffix?: string; tile?: boolean; size?: keyof typeof SIZES; className?: string
}) {
  const s = SIZES[size]
  return (
    <Link to={to} className={cn('flex shrink-0 items-center gap-2', className)} aria-label="Axe Genuine Spare Parts, home">
      <span className={cn('flex items-center gap-1.5', tile && 'rounded-lg bg-brand px-2.5 py-1')}>
        <img src="/logo-mark.webp" alt="" width={243} height={160} className={cn('w-auto', s.mark)} />
        <span className="flex flex-col items-start gap-1">
          <img src="/logo-word.webp" alt="AXE" width={357} height={72} className={cn('w-auto', s.word)} />
          <span className={cn('leading-none font-semibold whitespace-nowrap text-highlight uppercase', s.tag)}>Genuine spare parts</span>
        </span>
      </span>
      {suffix && (
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-white/80 uppercase">
          {suffix}
        </span>
      )}
    </Link>
  )
}
