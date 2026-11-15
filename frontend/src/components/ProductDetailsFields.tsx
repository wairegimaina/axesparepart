import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { Field, NativeSelect } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { get } from '@/lib/api'
import type { Brand, CategoryNode, Spec } from '@/lib/types'

export interface ProductDraft {
  name: string
  category_id: number | ''
  brand_name: string
  part_number: string
  description: string
  specifications: Spec[]
  compatibility: string
}

export const emptyProduct: ProductDraft = {
  name: '', category_id: '', brand_name: '', part_number: '', description: '', specifications: [], compatibility: '',
}

export function flattenCategories(nodes: CategoryNode[], prefix = ''): { id: number; label: string }[] {
  return nodes.flatMap((n) => [{ id: n.id, label: prefix + n.name }, ...flattenCategories(n.children, `${prefix}${n.name} › `)])
}

export function useCategoryOptions() {
  const q = useQuery({ queryKey: ['categories'], queryFn: () => get<CategoryNode[]>('/categories/') })
  return flattenCategories(q.data ?? [])
}

export function ProductDetailsFields({
  value, onChange, errors = {}, disabled,
}: {
  value: ProductDraft
  onChange: (v: ProductDraft) => void
  errors?: Record<string, string>
  disabled?: boolean
}) {
  const categories = useCategoryOptions()
  const brands = useQuery({ queryKey: ['brands', 'all'], queryFn: () => get<Brand[]>('/brands/?all=1') })
  const set = <K extends keyof ProductDraft>(key: K, v: ProductDraft[K]) => onChange({ ...value, [key]: v })
  const setSpec = (i: number, patch: Partial<Spec>) =>
    set('specifications', value.specifications.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  return (
    <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
      <Field label="Product name" htmlFor="p-name" required error={errors.name} className="sm:col-span-2">
        <Input id="p-name" value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Front brake pad set" />
      </Field>
      <Field label="Category" htmlFor="p-category" required error={errors.category_id}>
        <NativeSelect id="p-category" value={value.category_id} onChange={(e) => set('category_id', e.target.value ? Number(e.target.value) : '')}>
          <option value="">Choose a category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Brand / manufacturer" htmlFor="p-brand" required error={errors.brand_id || errors.brand_name} >
        <Input id="p-brand" list="brand-options" value={value.brand_name} onChange={(e) => set('brand_name', e.target.value)} autoComplete="off" />
        <datalist id="brand-options">{brands.data?.map((b) => <option key={b.id} value={b.name} />)}</datalist>
      </Field>
      <Field label="Manufacturer part number" htmlFor="p-pn" error={errors.part_number}  className="sm:col-span-2">
        <Input id="p-pn" value={value.part_number} onChange={(e) => set('part_number', e.target.value)} className="font-mono" />
      </Field>
      <Field label="Description" htmlFor="p-desc" error={errors.description} className="sm:col-span-2">
        <Textarea id="p-desc" rows={5} value={value.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <p className="text-sm font-medium">Technical specifications</p>
        {value.specifications.map((s, i) => (
          <div key={i} className="flex gap-2">
            <Input aria-label="Specification name" placeholder="e.g. Teeth" value={s.name} onChange={(e) => setSpec(i, { name: e.target.value })} />
            <Input aria-label="Specification value" placeholder="e.g. 43" value={s.value} onChange={(e) => setSpec(i, { value: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => set('specifications', value.specifications.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </div>
        ))}
        {errors.specifications && <p className="text-xs text-destructive">{errors.specifications}</p>}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => set('specifications', [...value.specifications, { name: '', value: '' }])}>
            <Plus /> Add specification
          </Button>
        </div>
      </div>
      <Field label="Fits these bikes" htmlFor="p-compat" error={errors.compatibility} hint="e.g. Bajaj Boxer 150, one per line" className="sm:col-span-2">
        <Textarea id="p-compat" rows={3} value={value.compatibility} onChange={(e) => set('compatibility', e.target.value)} />
      </Field>
    </fieldset>
  )
}

export function productPayload(p: ProductDraft) {
  return {
    name: p.name.trim(),
    category_id: p.category_id || null,
    brand_name: p.brand_name.trim(),
    part_number: p.part_number.trim(),
    description: p.description,
    specifications: p.specifications.filter((s) => s.name.trim() && s.value.trim()),
    compatibility: p.compatibility,
  }
}
