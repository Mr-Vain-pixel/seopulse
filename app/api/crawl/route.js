import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const MAX_URLS    = 200
const MAX_PAGES   = 80
const BATCH_SIZE  = 8
const TIMEOUT     = 8000

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(href, base) {
  try {
    const u = new URL(href, base)
    u.hash = ''
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.href
  } catch { return null }
}

function isInternal(url, origin) {
  try { return new URL(url).origin === origin } catch { return false }
}

function isCrawlable(url) {
  return !/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|css|js|woff|woff2|ttf|mp4|mp3|xml)(\?|$)/i.test(url)
}

async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOPulse-Bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml,*/*',
        ...opts.headers,
      },
      redirect: 'follow',
      ...opts,
    })
    return res
  } catch { return null }
}

// ── Sitemap Parser ────────────────────────────────────────────────────────────

async function fetchSitemap(sitemapUrl, origin, collected = new Set(), depth = 0) {
  if (depth > 3 || collected.size >= MAX_URLS) return collected

  const res = await safeFetch(sitemapUrl)
  if (!res || !res.ok) return collected

  const text = await res.text()
  const $ = cheerio.load(text, { xmlMode: true })

  // Sitemap Index (enthält weitere Sitemaps)
  const sitemapLocs = $('sitemapindex sitemap loc')
  if (sitemapLocs.length > 0) {
    for (const el of sitemapLocs.toArray().slice(0, 10)) {
      const subUrl = $(el).text().trim()
      if (subUrl) await fetchSitemap(subUrl, origin, collected, depth + 1)
      if (collected.size >= MAX_URLS) break
    }
    return collected
  }

  // Normale Sitemap mit URLs
  $('urlset url loc').each((_, el) => {
    const loc = $(el).text().trim()
    if (loc && isInternal(loc, origin)) {
      collected.add(normalizeUrl(loc, origin) || loc)
    }
  })

  return collected
}

async function discoverSitemapUrls(origin) {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemaps/sitemap.xml`,
  ]

  // Auch robots.txt nach Sitemap-Angabe prüfen
  const robotsRes = await safeFetch(`${origin}/robots.txt`)
  if (robotsRes?.ok) {
    const robotsTxt = await robotsRes.text()
    const sitemapMatches = robotsTxt.match(/Sitemap:\s*(.+)/gi) || []
    for (const match of sitemapMatches) {
      const url = match.replace(/Sitemap:\s*/i, '').trim()
      if (url && !candidates.includes(url)) candidates.unshift(url)
    }
  }

  for (const candidate of candidates) {
    const collected = new Set()
    await fetchSitemap(candidate, origin, collected)
    if (collected.size > 0) {
      return { urls: [...collected], source: candidate }
    }
  }

  return { urls: [], source: null }
}

// ── HTML Crawler ──────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const res = await safeFetch(url)
  if (!res) return { status: -1, html: '', finalUrl: url, error: 'Verbindungsfehler' }
  const contentType = res.headers.get('content-type') || ''
  const html = contentType.includes('text/html') ? await res.text() : ''
  return { status: res.status, html, finalUrl: res.url }
}

function extractLinks($, baseUrl, origin) {
  const internal = new Set()
  const external = new Set()

  $('a[href]').each((_, el) => {
    const href = $( el).attr('href')
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('#')) return
    const abs = normalizeUrl(href, baseUrl)
    if (!abs) return
    if (isInternal(abs, origin)) {
      if (isCrawlable(abs)) internal.add(abs)
    } else {
      external.add(abs)
    }
  })

  // CTAs und Buttons mit Links
  $('[data-href], [data-url]').each((_, el) => {
    const href = $(el).attr('data-href') || $(el).attr('data-url')
    if (!href) return
    const abs = normalizeUrl(href, baseUrl)
    if (abs && isInternal(abs, origin) && isCrawlable(abs)) internal.add(abs)
  })

  // Formular-Actions
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action')
    if (!action || action.startsWith('#')) return
    const abs = normalizeUrl(action, baseUrl)
    if (abs && isInternal(abs, origin)) internal.add(abs)
  })

  return { internal: [...internal], external: [...external] }
}

// ── URL Status Check ──────────────────────────────────────────────────────────

async function checkUrl(url) {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOPulse-Bot/1.0)' },
    })
    const ms = Date.now() - start
    const redirectTo = [301, 302, 303, 307, 308].includes(res.status)
      ? res.headers.get('location') : null
    return { status: res.status, ms, redirectTo, error: null }
  } catch (err) {
    return {
      status: err.name === 'TimeoutError' ? 0 : -1,
      ms: Date.now() - start,
      redirectTo: null,
      error: err.name === 'TimeoutError' ? 'Timeout' : err.message,
    }
  }
}

function categorize(status, error) {
  if (error === 'Timeout' || status === 0) return 'timeout'
  if (status >= 200 && status < 300) return 'ok'
  if ([301, 302, 303, 307, 308].includes(status)) return 'redirect'
  if (status === 403) return 'forbidden'
  if (status === 404 || status === 410) return 'not_found'
  if (status >= 500) return 'error'
  return 'error'
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export async function POST(request) {
  const { url } = await request.json()

  if (!url?.trim()) {
    return NextResponse.json({ error: 'Keine URL angegeben.' }, { status: 400 })
  }

  let baseUrl = url.trim()
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl

  let origin
  try { origin = new URL(baseUrl).origin }
  catch { return NextResponse.json({ error: 'Ungültige URL.' }, { status: 400 }) }

  // ── Phase 1: URL-Entdeckung ───────────────────────────────────────────────
  // Strategie A: Sitemap.xml (funktioniert auch bei JS-SPAs!)
  const { urls: sitemapUrls, source: sitemapSource } = await discoverSitemapUrls(origin)

  let discoveredUrls = new Set([baseUrl])
  let urlSource = 'html'
  const allExternalUrls = new Set()
  const pageLinksMap = new Map() // pageUrl → anzahl gefundener links

  if (sitemapUrls.length > 0) {
    // Sitemap gefunden – alle URLs daraus nehmen
    sitemapUrls.slice(0, MAX_URLS).forEach(u => discoveredUrls.add(u))
    urlSource = 'sitemap'
  }

  // Strategie B: Rekursives HTML-Crawling (immer zusätzlich zur Sitemap)
  const toCrawl = [baseUrl]
  const htmlCrawled = new Set([baseUrl])

  while (toCrawl.length > 0 && htmlCrawled.size < MAX_PAGES) {
    const batch = toCrawl.splice(0, BATCH_SIZE)
    const results = await Promise.all(batch.map(async (pageUrl) => {
      const { status, html, finalUrl } = await fetchPage(pageUrl)
      return { pageUrl, status, html, finalUrl }
    }))

    for (const { pageUrl, status, html, finalUrl } of results) {
      if (!html) { pageLinksMap.set(pageUrl, 0); continue }

      const $ = cheerio.load(html)
      const { internal, external } = extractLinks($, finalUrl || pageUrl, origin)

      pageLinksMap.set(pageUrl, internal.length + external.length)
      external.forEach(u => allExternalUrls.add(u))

      for (const link of internal) {
        discoveredUrls.add(link)
        if (!htmlCrawled.has(link) && htmlCrawled.size < MAX_PAGES) {
          htmlCrawled.add(link)
          toCrawl.push(link)
        }
      }
    }
  }

  // ── Phase 2: Alle internen URLs prüfen ───────────────────────────────────
  const internalUrls = [...discoveredUrls].slice(0, MAX_URLS)
  const internalResults = []

  for (let i = 0; i < internalUrls.length; i += BATCH_SIZE) {
    const batch = internalUrls.slice(i, i + BATCH_SIZE)
    const checked = await Promise.all(batch.map(async (u) => {
      const { status, ms, redirectTo, error } = await checkUrl(u)
      return {
        url: u,
        type: 'internal',
        status,
        ms,
        redirectTo,
        category: categorize(status, error),
        error: error || null,
        linksFound: pageLinksMap.get(u) ?? null,
      }
    }))
    internalResults.push(...checked)
  }

  // ── Phase 3: Externe URLs prüfen ─────────────────────────────────────────
  const externalUrls = [...allExternalUrls].slice(0, 50)
  const externalResults = []

  for (let i = 0; i < externalUrls.length; i += BATCH_SIZE) {
    const batch = externalUrls.slice(i, i + BATCH_SIZE)
    const checked = await Promise.all(batch.map(async (u) => {
      const { status, ms, redirectTo, error } = await checkUrl(u)
      return {
        url: u,
        type: 'external',
        status,
        ms,
        redirectTo,
        category: categorize(status, error),
        error: error || null,
        linksFound: null,
      }
    }))
    externalResults.push(...checked)
  }

  // ── Phase 4: Zusammenführen ───────────────────────────────────────────────
  const allResults = [...internalResults, ...externalResults]
  const order = { not_found: 0, error: 1, timeout: 2, forbidden: 3, redirect: 4, ok: 5, other: 6 }
  allResults.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9))

  const summary = {
    total:           allResults.length,
    pagesVisited:    htmlCrawled.size,
    ok:              allResults.filter(r => r.category === 'ok').length,
    redirects:       allResults.filter(r => r.category === 'redirect').length,
    notFound:        allResults.filter(r => r.category === 'not_found').length,
    forbidden:       allResults.filter(r => r.category === 'forbidden').length,
    errors:          allResults.filter(r => r.category === 'error').length,
    timeouts:        allResults.filter(r => r.category === 'timeout').length,
    externalChecked: externalResults.length,
    truncated:       discoveredUrls.size > MAX_URLS,
    totalFound:      discoveredUrls.size,
    urlSource,
    sitemapSource,
  }

  return NextResponse.json({ domain: origin, summary, urls: allResults })
}
