import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { NoPhoto } from '@/components/ProductCard'
import type { Image } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Product photo carousel. Photos sit side by side in a scroll-snapping track, so they slide with the
 * arrows, the dots, the thumbnails or the keyboard, and swipe natively on touch screens. Thumbnails run
 * down the left (along the bottom on phones). Hovering the current photo with a mouse zooms in where
 * the pointer is.
 */
export function Gallery({ images, name, brand, type, badge }: {
  images: Image[]; name: string; brand: string; type: string; badge?: React.ReactNode
}) {
  const [active, setActive] = useState(0)
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const many = images.length > 1

  const goTo = (i: number) => {
    const el = track.current
    if (!el || !images.length) return
    const next = (i + images.length) % images.length
    setActive(next)
    setZoom(null)
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
  }

  // Keep the counter, dots and thumbnails in step when the user swipes.
  const onScroll = () => {
    const el = track.current
    if (!el || !el.clientWidth) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== active && i >= 0 && i < images.length) {
      setActive(i)
      setZoom(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!many) return
    if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(active - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(active + 1) }
  }

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {many && (
        <div className="flex gap-2 overflow-x-auto p-1 sm:max-h-[min(560px,70vh)] sm:w-[76px] sm:shrink-0 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              aria-label={`Show photo ${i + 1} of ${images.length}`}
              aria-current={i === active}
              onClick={() => goTo(i)}
              className={cn(
                'relative size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-card p-1 transition sm:size-[72px]',
                i === active ? 'border-primary shadow-[0_6px_16px_-8px_oklch(0.45_0.2_262/0.7)]' : 'border-transparent opacity-70 ring-1 ring-border hover:opacity-100',
              )}
            >
              <img src={img.url} alt="" loading="lazy" className="h-full w-full rounded-lg object-contain" />
            </button>
          ))}
        </div>
      )}

      <div
        role={many ? 'region' : undefined}
        aria-roledescription={many ? 'carousel' : undefined}
        aria-label={many ? `${name} photos` : undefined}
        tabIndex={many ? 0 : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          'surface group relative aspect-square flex-1 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary',
          images.length ? 'bg-[radial-gradient(circle_at_50%_40%,var(--card),var(--secondary))]' : 'bg-brand text-brand-foreground',
        )}
      >
        {images.length ? (
          <div
            ref={track}
            onScroll={onScroll}
            className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {images.map((img, i) => (
              <div
                key={img.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${images.length}`}
                aria-hidden={i !== active}
                onPointerMove={i === active ? onPointerMove : undefined}
                onPointerLeave={() => setZoom(null)}
                className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center overflow-hidden md:cursor-zoom-in"
              >
                <img
                  src={img.url}
                  alt={img.alt_text || name}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                  className="h-full w-full object-contain p-6 mix-blend-multiply dark:mix-blend-normal transition-transform duration-150 ease-out select-none"
                  style={zoom && i === active ? { transform: 'scale(2)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <NoPhoto brand={brand} type={type} large />
          </div>
        )}

        {badge && <div className="pointer-events-none absolute top-3 left-3">{badge}</div>}

        {many && (
          <>
            <button type="button" aria-label="Previous photo" onClick={() => goTo(active - 1)}
              className="absolute top-1/2 left-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow ring-1 ring-border backdrop-blur transition hover:bg-card sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" aria-label="Next photo" onClick={() => goTo(active + 1)}
              className="absolute top-1/2 right-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-foreground shadow ring-1 ring-border backdrop-blur transition hover:bg-card sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <ChevronRight className="size-5" />
            </button>

            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {images.map((img, i) => (
                <button key={img.id} type="button" aria-label={`Go to photo ${i + 1}`} aria-current={i === active}
                  onClick={() => goTo(i)}
                  className={cn('h-2 rounded-full transition-all', i === active ? 'w-5 bg-primary' : 'w-2 bg-foreground/30 hover:bg-foreground/50')} />
              ))}
            </div>

            <span aria-live="polite" className="absolute right-3 bottom-3 rounded-full bg-foreground/70 px-2 py-0.5 text-xs font-medium text-background tabular-nums">
              {active + 1} / {images.length}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
