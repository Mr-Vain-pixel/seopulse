import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

const MAX_URLS   = 50   // Max URLs zu crawlen (Vercel Hobby: 60s Limit)
const BATCH_SIZE = 5    // Gleichzeitige Requests
const TIMEOUT    = 6000 // ms pro Request

async function checkUrl(url) {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual', // Weiterleitungen manuell behandeln
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'SEOPulse-Bot/1.0 (Link Checker)' },
    })
    const ms = Date.now() - start
    const redirectTo = (res.status === 301 || res.status === 302 || res.status === 308)
      ? res.headers.get('location') : null
    return { url, status: res.status, ms, redirectTo, error: null }
  } catch (err) {
    const ms = Date.now() - start
    const isTimeout = err.name === 'TimeoutError' || ms >= TIMEOUT
    return { url, status: isTimeout ? 0 : -1, ms, redirectTo: null, error: isTimeout ? 'Timeout' : err.message }
  }
}

async function runBatches(urls) {
  const results = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(batch.map(checkUrl))
    results.push(...batchResults)
  }
  return results
}

export async function POST(request) {
  const { url } = await request.json()

  if (!url?.trim()) {
    return NextResponse.json({ error: 'Keine URL angegeben.' }, { status: 400 })
  }

  let baseUrl = url.trim()
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl

  let origin
  try {
    origin = new URL(baseUrl).origin
  } catch {
    return NextResponse.json({ error: 'Ungültige URL.' }, { status: 400 })
  }

  // 1. Homepage laden und alle internen Links extrahieren
  let html = ''
  let homepageStatus = 0
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'SEOPulse-Bot/1.0', 'Accept': 'text/html' },
    })
    homepageStatus = res.status
    html = await res.text()
  } catch (err) {
    return NextResponse.json({
      error: `Startseite nicht erreichbar: ${err.message}`,
    }, { status: 422 })
  }

  const $ = cheerio.load(html)
  const discovered = new Set()
  discovered.add(baseUrl)

  // Alle internen <a href> Links sammeln
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    try {
      const abs = new URL(href, baseUrl)
      // Nur gleiche Domain, keine Fragments, keine externen Links
      if (abs.origin === origin && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        abs.hash = ''   // Fragment entfernen
        discovered.add(abs.href)
      }
    } catch {}
  })

  // URLs limitieren
  const urlsToCheck = [...discovered].slice(0, MAX_URLS)

  // 2. Alle URLs prüfen (in Batches)
  const results = await runBatches(urlsToCheck)

  // 3. Ergebnisse kategorisieren
  const categorized = results.map(r => {
    let category
    if (r.error === 'Timeout' || r.status === 0) category = 'timeout'
    else if (r.status === 200) category = 'ok'
    else if (r.status === 301 || r.status === 302 || r.status === 308) category = 'redirect'
    else if (r.status === 403) category = 'forbidden'
    else if (r.status === 404) category = 'not_found'
    else if (r.status >= 500) category = 'error'
    else if (r.status === -1) category = 'error'
    else category = 'other'

    return {
      url: r.url,
      status: r.status,
      category,
      ms: r.ms,
      redirectTo: r.redirectTo,
      error: r.error,
    }
  })

  // 4. Zusammenfassung
  const summary = {
    total:      categorized.length,
    ok:         categorized.filter(r => r.category === 'ok').length,
    redirects:  categorized.filter(r => r.category === 'redirect').length,
    notFound:   categorized.filter(r => r.category === 'not_found').length,
    forbidden:  categorized.filter(r => r.category === 'forbidden').length,
    errors:     categorized.filter(r => r.category === 'error').length,
    timeouts:   categorized.filter(r => r.category === 'timeout').length,
    avgMs:      Math.round(categorized.reduce((s, r) => s + r.ms, 0) / categorized.length),
    truncated:  discovered.size > MAX_URLS,
    totalFound: discovered.size,
  }

  // Sortierung: Fehler zuerst, dann Weiterleitungen, dann OK
  const order = { not_found: 0, error: 1, timeout: 2, forbidden: 3, redirect: 4, ok: 5, other: 6 }
  categorized.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9))

  return NextResponse.json({ domain: origin, summary, urls: categorized })
}
