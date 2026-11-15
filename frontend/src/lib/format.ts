const kes = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 })

export const money = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '—' : kes.format(Number(value))

export const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export const dateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

export const bytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

export const CONDITION_LABEL = { new: 'New', refurbished: 'Refurbished', used: 'Used' } as const
export const AVAILABILITY_LABEL = { in_stock: 'In stock', out_of_stock: 'Out of stock', on_request: 'On request' } as const
