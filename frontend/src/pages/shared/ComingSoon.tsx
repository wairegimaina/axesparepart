import { Clock } from 'lucide-react'
import { PageHeader } from '@/components/common'

export default function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center">
        <Clock className="mb-3 size-10 text-muted-foreground/60" />
        <p className="font-medium">Coming in a later phase</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </>
  )
}
