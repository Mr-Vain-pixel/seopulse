import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const MAX_PAGES   = 80   // Max Seiten die gecrawlt werden
const MAX_URLS    = 200  // Max URLs total geprüft
const BATCH_SIZE  = 6    // Gleichzeitige Requests
const TIMEOUT     = 7000 // ms pro Request

// Hilfsfunktion: URL bereinigen
function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base)
    u.hash = ''
    // Trailing slash normalisieren
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.href
  } catch { return null }
}

// Hilfsfunktion: Ist URL intern?
function isInternal(url, origin) {
  try { return new URL(url).origin === origin } catch { return false }
}

// Hilfsfunktion: Soll URL gecrawlt werden (kein Bild, PDF, etc.)?
function isCrawlable(url) {
  return !/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|css|js|woff|woff2|ttf|mp4|mp3)(\?|$)/i.test(url)
}

// Eine URL fetchen und HTML zurückgeben
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
      headers: {
        'User-Agent': 'SEOPulse-Bot/1.0 (Deep Crawler)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    const contentType = res.headers.get('content-type') || ''
    const html = contentType.includes('text/html') ? await res.text() : ''
    return { status: res.status, html, finalUrl: res.url }
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError'
    return { status: isTimeout ? 0 : -1, html: '', finalUrl: url, error: isTimeout ? 'Timeout' : err.message }
  }
}

// Eine URL nur HEAD-prüfen (für externe Links)
async function checkUrl(url) {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'SEOPulse-Bot/1.0' },
    })
    const ms = Date.now() - start
    const redirectTo = [301, 302, 303, 307, 308].includes(res.status)
      ? res.headers.get('location') : null
    return { status: res.status, ms, redirectTo, error: null }
  } catch (err) {
    const ms = Date.now() - start
    return {
      status: err.name === 'TimeoutError' ? 0 : -1,
      ms,
      redirectTo: null,
      error: err.name === 'TimeoutError' ? 'Timeout' : err.message,
    }
  }
}

// Alle Links aus HTML extrahieren
function extractLinks($, baseUrl, origin) {
  const internal = new Set()
  const external = new Set()

  $('a[href], button[onclick], [data-href]').each((_, el) => {
    const href = $(el).attr('href') || $(el).attr('data-href')
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('#')) return

    const abs = normalizeUrl(href, baseUrl)
    if (!abs) return

    if (isInternal(abs, origin)) {
      if (isCrawlable(abs)) internal.add(abs)
    } else {
      external.add(abs)
    }
  })

  // Auch CTAs: Buttons mit Links, Forms
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action')
    if (!action) return
    const abs = normalizeUrl(action, baseUrl)
    if (abs && isInternal(abs, origin)) internal.add(abs)
  })

  return { internal: [...internal], external: [...external] }
}

// Kategorie bestimmen
function categorize(status, error) {
  if (error === 'Timeout' || status === 0) return 'timeout'
  if (status === 200 || status === 201) return 'ok'
  if ([301, 302, 303, 307, 308].includes(status)) return 'redirect'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 410) return 'not_found'
  if (status >= 500) return 'error'
  if (status === -1) return 'error'
  return 'other'
}

export async function POST(request) {
  const { url } = await request.json()

  if (!url?.trim()) {
    return NextResponse.json({ error: 'Keine URL angegeben.' }, { status: 400 })
  }

  let baseUrl = url.trim()
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl

  let origin
  try { origin = new URL(baseUrl).origin } catch {
    return NextResponse.json({ error: 'Ungültige URL.' }, { status: 400 })
  }

  // ── Phase 1: Rekursives Crawling ─────────────────────────────────────────
  // Alle internen Seiten besuchen und Links sammeln

  const crawledPages   = new Map()  // url → { status, html, links }
  const toCrawl        = [baseUrl]  // Queue
  const crawledUrls    = new Set([baseUrl])
  const allExternalUrls = new Set()

  while (toCrawl.length > 0 && crawledPages.size < MAX_PAGES) {
    // Nächsten Batch holen
    const batch = toCrawl.splice(0, BATCH_SIZE)

    const results = await Promise.all(batch.map(async (pageUrl) => {
      const { status, html, finalUrl, error } = await fetchPage(pageUrl)
      return { pageUrl, status, html, finalUrl, error }
    }))

    for (const { pageUrl, status, html, finalUrl, error } of results) {
      const pageLinks = { internal: [], external: [] }

      if (html) {
        const $ = cheerio.load(html)
        const extracted = extractLinks($, finalUrl || pageUrl, origin)
        pageLinks.internal = extracted.internal
        pageLinks.external = extracted.external

        // Neue interne URLs zur Queue hinzufügen
        for (const link of extracted.internal) {
          if (!crawledUrls.has(link) && crawledPages.size + toCrawl.length < MAX_PAGES) {
            crawledUrls.add(link)
            toCrawl.push(link)
          }
        }

        // Externe URLs sammeln
        extracted.external.forEach(u => allExternalUrls.add(u))
      }

      crawledPages.set(pageUrl, { status, error, links: pageLinks })
    }
  }

  // ── Phase 2: Alle gefundenen URLs prüfen ─────────────────────────────────
  // Interne gecrawlte Seiten + externe Links prüfen

  // Alle internen URLs die gecrawlt wurden
  const internalResults = []
  for (const [pageUrl, data] of crawledPages.entries()) {
    const cat = categorize(data.status, data.error)
    internalResults.push({
      url: pageUrl,
      type: 'internal',
      status: data.status,
      category: cat,
      error: data.error || null,
      linksFound: data.links.internal.length + data.links.external.length,
    })
  }

  // Externe URLs prüfen (max 60, in Batches)
  const externalUrls = [...allExternalUrls].slice(0, 60)
  const externalResults = []

  for (let i = 0; i < externalUrls.length; i += BATCH_SIZE) {
    const batch = externalUrls.slice(i, i + BATCH_SIZE)
    const checked = await Promise.all(batch.map(async (extUrl) => {
      const { status, ms, redirectTo, error } = await checkUrl(extUrl)
      return {
        url: extUrl,
        type: 'external',
        status,
        ms,
        redirectTo,
        category: categorize(status, error),
        error: error || null,
        linksFound: 0,
      }
    }))
    externalResults.push(...checked)
  }

  // ── Phase 3: Zusammenführen & Sortieren ──────────────────────────────────
  const allResults = [...internalResults, ...externalResults]

  const order = { not_found: 0, error: 1, timeout: 2, forbidden: 3, redirect: 4, ok: 5, other: 6 }
  allResults.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9))

  const summary = {
    total:          allResults.length,
    pagesVisited:   crawledPages.size,
    ok:             allResults.filter(r => r.category === 'ok').length,
    redirects:      allResults.filter(r => r.category === 'redirect').length,
    notFound:       allResults.filter(r => r.category === 'not_found').length,
    forbidden:      allResults.filter(r => r.category === 'forbidden').length,
    errors:         allResults.filter(r => r.category === 'error').length,
    timeouts:       allResults.filter(r => r.category === 'timeout').length,
    externalChecked: externalResults.length,
    truncated:      crawledUrls.size > MAX_PAGES,
    totalFound:     crawledUrls.size,
  }

  return NextResponse.json({ domain: origin, summary, urls: allResults })
}
