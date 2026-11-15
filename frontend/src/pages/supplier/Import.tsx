import { useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { FileButton, PageHeader, useBusy } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { get, upload } from '@/lib/api'

interface Result {
  created: number
  updated: number
  matched_catalogue: number
  skipped: number
  dry_run: boolean
  errors: { row: number; error: string }[]
}

export default function Import() {
  const qc = useQueryClient()
  const [busy, run] = useBusy()
  const [dryRun, setDryRun] = useState(true)
  const [result, setResult] = useState<Result | null>(null)

  const downloadTemplate = async () => {
    const blob = await get<Blob>('/supplier/import/template/')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'axespareparts-product-import.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader title="Bulk import" description="Upload products from an Excel file." />
      <ol className="grid gap-4">
        <li className="surface p-5">
          <p className="font-medium">1. Download the template</p>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per product. Existing SKUs are updated.
          </p>
          <Button variant="outline" className="mt-3" onClick={downloadTemplate}><Download /> Download template</Button>
        </li>
        <li className="surface p-5">
          <p className="font-medium">2. Upload your file</p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(!!v)} />
            Check the file without saving anything (recommended first)
          </label>
          <div className="mt-3">
            <FileButton
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              label={dryRun ? 'Check file' : 'Import file'}
              variant="default"
              busy={busy}
              onFile={(f) =>
                run(async () => {
                  try {
                    const r = await upload<Result>('/supplier/import/', f, { dry_run: String(dryRun) })
                    setResult(r)
                    if (!r.dry_run) qc.invalidateQueries({ queryKey: ['supplier'] })
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                })
              }
            />
          </div>
        </li>
      </ol>

      {result && (
        <section className="mt-6 surface p-5">
          <h2 className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="size-4" /> {result.dry_run ? 'Check result (nothing saved)' : 'Import complete'}</h2>
          <p className="mt-2 text-sm">
            {result.dry_run ? 'Would create' : 'Created'} <b>{result.created}</b> draft product{result.created === 1 ? '' : 's'}
            {result.matched_catalogue > 0 && <> ({result.matched_catalogue} matched existing catalogue parts)</>}, {result.dry_run ? 'would update' : 'updated'} <b>{result.updated}</b>.
            {result.errors.length > 0 && <> <b className="text-destructive">{result.errors.length}</b> row{result.errors.length > 1 ? 's' : ''} had problems.</>}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-80 divide-y overflow-y-auto rounded-lg border text-sm">
              {result.errors.map((e) => (
                <li key={e.row} className="flex gap-3 px-3 py-2"><span className="w-16 shrink-0 font-mono text-muted-foreground">Row {e.row}</span><span>{e.error}</span></li>
              ))}
            </ul>
          )}
          {result.dry_run && result.errors.length === 0 && result.created + result.updated > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">Looks good. Untick the check box above and upload again to import.</p>
          )}
          {!result.dry_run && result.created > 0 && (
            <p className="mt-3 text-sm">New products are saved as drafts. <Link to="/supplier/products?status=draft" className="text-primary underline">Review and submit them</Link>.</p>
          )}
        </section>
      )}
    </>
  )
}
