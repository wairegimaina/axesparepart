import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError } from './api'

/**
 * Copy field errors from a DRF 400 response onto the form and return any message that
 * belongs above the form: the `detail`, or errors for fields the form doesn't show
 * (pass `known` to say which fields it does show).
 */
export function applyApiErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, known?: string[]): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : 'Something went wrong.'
  const leftover: string[] = []
  for (const [field, message] of Object.entries(err.fields)) {
    if (!known || known.includes(field)) setError(field as Path<T>, { message })
    else leftover.push(message)
  }
  if (leftover.length) return leftover.join(' ')
  return Object.keys(err.fields).length ? '' : err.message
}
