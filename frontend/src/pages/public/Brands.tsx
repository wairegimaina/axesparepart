import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { EmptyState, Loading } from '@/components/common'
import { get } from '@/lib/api'
import type { Brand } from '@/lib/types'
import { cn } from '@/lib/utils'

export function useBrands() {
  return useQuery({ queryKey: ['brands'], queryFn: () => get<Brand[]>('/brands/') })
}

/** A brand tile: its logo when there is one, otherwise its name set in the heading font. */
export function BrandTile({ b, className }: { b: Brand; className?: string }) {
  return (
    <Link
      to={`/products?brand=${b.slug}`}
      className={cn('surface group flex flex-col items-center justify-center gap-2 p-4 text-center transition hover:-translate-y-0.5 hover:ring-1 hover:ring-primary/30', className)}
    >
      <span className="flex h-12 w-full items-center justify-center">
        {b.logo_url ? (
          <img src={b.logo_url} alt={b.name} className="max-h-12 max-w-[80%] object-contain" />
        ) : (
          <span className="font-heading text-2xl leading-none font-bold tracking-wide uppercase italic text-brand transition group-hover:text-primary dark:text-foreground">
            {b.name}
          </span>
        )}
      </span>
      {b.product_count != null && (
        <span className="text-xs text-muted-foreground">{b.product_count} part{b.product_count === 1 ? '' : 's'}</span>
      )}
    </Link>
  )
}

export default function Brands() {
  const { data, isLoading } = useBrands()
  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-3xl">Brands</h1>
      {isLoading ? (
        <Loading />
      ) : data?.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.map((b) => <BrandTile key={b.id} b={b} />)}
        </div>
      ) : (
        <EmptyState title="No brands yet" />
      )}
    </div>
  )
}
