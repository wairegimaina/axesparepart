import { useEffect } from 'react'

const SITE = 'Axe Spare Parts'
const DEFAULT_DESCRIPTION =
  'Genuine and quality motorcycle spare parts for boda bodas and other bikes in Kenya. Order online, delivered across all 47 counties.'

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = value
}

/**
 * Page title, description and (optionally) schema.org structured data for search engines and link previews.
 * Pass `undefined` while data loads; the defaults come back when the page unmounts.
 */
export function usePageMeta(title?: string, description?: string, structuredData?: object) {
  const json = structuredData ? JSON.stringify(structuredData) : ''
  useEffect(() => {
    if (title === undefined) return
    const fullTitle = title ? `${title} | ${SITE}` : `${SITE}: motorcycle spare parts in Kenya`
    const desc = (description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim().slice(0, 160)
    document.title = fullTitle
    setMeta('name', 'description', desc)
    setMeta('property', 'og:title', fullTitle)
    setMeta('property', 'og:description', desc)
    setMeta('property', 'og:url', window.location.href)
    let script: HTMLScriptElement | null = null
    if (json) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.text = json
      document.head.appendChild(script)
    }
    return () => {
      document.title = SITE
      setMeta('name', 'description', DEFAULT_DESCRIPTION)
      script?.remove()
    }
  }, [title, description, json])
}
