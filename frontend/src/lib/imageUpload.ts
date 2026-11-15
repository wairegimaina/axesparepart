import { toast } from 'sonner'
import { upload } from '@/lib/api'

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
export const MAX_IMAGE_MB = 5
export const MAX_PRODUCT_IMAGES = 8
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Upload several photos one after another to an endpoint that takes one `file` per request.
 * Quick checks here (type, size, how many still fit) give instant feedback; the server
 * re-checks everything and re-encodes each image, so these checks are only for convenience.
 * With `removeBackground` (the default) the server cuts the part out of its background and
 * trims it; photos where that doesn't work cleanly are kept as they are.
 * Returns how many were uploaded.
 */
export async function uploadImages(
  path: string, files: File[], remaining: number, { removeBackground = true }: { removeBackground?: boolean } = {},
): Promise<number> {
  const problems: string[] = []
  const ok: File[] = []
  for (const f of files) {
    if (!ALLOWED.has(f.type)) problems.push(`${f.name}: not a JPG, PNG or WebP image`)
    else if (f.size > MAX_IMAGE_MB * 1024 * 1024) problems.push(`${f.name}: larger than ${MAX_IMAGE_MB} MB`)
    else ok.push(f)
  }
  if (remaining <= 0) {
    toast.error(`This product already has the maximum of ${MAX_PRODUCT_IMAGES} photos.`)
    return 0
  }
  if (ok.length > remaining) {
    problems.push(`Only ${remaining} more photo${remaining === 1 ? '' : 's'} fit (limit ${MAX_PRODUCT_IMAGES}); the rest were skipped`)
    ok.splice(remaining)
  }

  let done = 0
  const verb = removeBackground ? 'Uploading and removing backgrounds' : 'Uploading'
  const toastId = ok.length ? toast.loading(ok.length > 1 ? `${verb}: 0 of ${ok.length} photos…` : `${verb}…`) : undefined
  for (const f of ok) {
    try {
      await upload(path, f, { remove_background: String(removeBackground) })
      done++
      if (toastId !== undefined && ok.length > 1) toast.loading(`${verb}: ${done} of ${ok.length} photos…`, { id: toastId })
    } catch (e) {
      problems.push(`${f.name}: ${(e as Error).message}`)
    }
  }
  if (toastId !== undefined) toast.dismiss(toastId)
  if (done) toast.success(done === 1 ? 'Photo added' : `${done} photos added`)
  if (problems.length) toast.error(problems.length === 1 ? problems[0] : `${problems.length} photos not added`, {
    description: problems.length > 1 ? problems.join('\n') : undefined,
    classNames: { description: 'whitespace-pre-line' },
  })
  return done
}
