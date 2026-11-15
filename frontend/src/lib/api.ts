/**
 * API client. The SPA and Django share one origin (Vite proxy locally, Render rewrite in
 * production), so auth is Django's session cookie and every write sends the CSRF token.
 */

export class ApiError extends Error {
  status: number
  fields: Record<string, string>
  raw: unknown
  constructor(status: number, message: string, fields: Record<string, string> = {}, raw: unknown = null) {
    super(message)
    this.status = status
    this.fields = fields
    this.raw = raw
  }

  /** Field errors of a nested serializer, e.g. nested('product_details') -> { name: '…' } */
  nested(key: string): Record<string, string> {
    const v = (this.raw as Record<string, unknown> | null)?.[key]
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).map(([k, e]) => [k, flatten(e)]))
  }
}

function readCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(name + '='))
    ?.split('=')[1]
}

let csrfReady: Promise<void> | null = null
function ensureCsrf() {
  if (readCookie('csrftoken')) return Promise.resolve()
  csrfReady ??= fetch('/api/auth/csrf/', { credentials: 'same-origin' }).then(() => undefined)
  return csrfReady
}

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(' ')
  if (value && typeof value === 'object')
    return Object.entries(value)
      .map(([k, v]) => (k === 'non_field_errors' ? flatten(v) : `${k}: ${flatten(v)}`))
      .join(' ')
  return value == null ? '' : String(value)
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* not JSON */
  }
  const fields: Record<string, string> = {}
  let message = res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.'
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body)) {
      if (k === 'detail' || k === 'non_field_errors') message = flatten(v)
      else fields[k] = flatten(v)
    }
    if (!('detail' in body) && Object.keys(fields).length) message = Object.values(fields)[0]
  } else if (Array.isArray(body)) {
    message = flatten(body)
  }
  return new ApiError(res.status, message, fields, body)
}

type Options = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal }

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    await ensureCsrf()
    headers['X-CSRFToken'] = readCookie('csrftoken') ?? ''
  }
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal })
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = (path: string) => api<void>(path, { method: 'DELETE' })
export function upload<T>(path: string, file: File, extra: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return api<T>(path, { method: 'POST', form })
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}
