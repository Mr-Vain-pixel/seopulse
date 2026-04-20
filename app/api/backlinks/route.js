import { NextResponse } from 'next/server'

export async function POST(request) {
  const { domain } = await request.json()

  if (!domain?.trim()) {
    return NextResponse.json({ error: 'Keine Domain angegeben.' }, { status: 400 })
  }

  const DFS_LOGIN    = process.env.DATAFORSEO_LOGIN
  const DFS_PASSWORD = process.env.DATAFORSEO_PASSWORD

  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return NextResponse.json({
      error: 'DataForSEO API-Zugangsdaten fehlen. Bitte in Vercel → Settings → Environment Variables eintragen.',
    }, { status: 500 })
  }

  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64')
  const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }

  const cleanDomain = domain.trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase()

  const [summaryRes, backlinksRes, domainsRes, anchorsRes] = await Promise.allSettled([

    fetch('https://api.dataforseo.com/v3/backlinks/summary/live', {
      method: 'POST', headers,
      body: JSON.stringify([{ target: cleanDomain, include_subdomains: true }]),
    }).then(r => r.json()),

    fetch('https://api.dataforseo.com/v3/backlinks/backlinks/live', {
      method: 'POST', headers,
      body: JSON.stringify([{
        target: cleanDomain,
        limit: 20,
        order_by: ['rank,desc'],
        include_subdomains: true,
        filters: ['dofollow,=,true'],
      }]),
    }).then(r => r.json()),

    fetch('https://api.dataforseo.com/v3/backlinks/referring_domains/live', {
      method: 'POST', headers,
      body: JSON.stringify([{
        target: cleanDomain,
        limit: 15,
        order_by: ['rank,desc'],
        include_subdomains: true,
      }]),
    }).then(r => r.json()),

    fetch('https://api.dataforseo.com/v3/backlinks/anchors/live', {
      method: 'POST', headers,
      body: JSON.stringify([{
        target: cleanDomain,
        limit: 10,
        order_by: ['backlinks,desc'],
        include_subdomains: true,
      }]),
    }).then(r => r.json()),
  ])

  const summaryData   = summaryRes.status   === 'fulfilled' ? summaryRes.value   : null
  const backlinksData = backlinksRes.status  === 'fulfilled' ? backlinksRes.value  : null
  const domainsData   = domainsRes.status   === 'fulfilled' ? domainsRes.value   : null
  const anchorsData   = anchorsRes.status   === 'fulfilled' ? anchorsRes.value   : null

  // Robuster Fehlercheck via status_code (20000 = OK, alles andere = Fehler)
  const task0 = summaryData?.tasks?.[0]
  if (task0 && task0.status_code !== 20000) {
    const code = task0.status_code
    const msg  = task0.status_message || 'Unbekannter Fehler'

    // Häufige Fehlercodes erklären
    if (code === 40501) {
      return NextResponse.json({
        error: 'Die Backlinks API erfordert ein separates Abonnement bei DataForSEO ($100/Monat Mindestbetrag). Bitte aktiviere die Backlinks API in deinem DataForSEO-Dashboard unter "API Access".',
      }, { status: 402 })
    }
    if (code === 40100 || code === 40200) {
      return NextResponse.json({
        error: 'DataForSEO Login fehlgeschlagen. Bitte prüfe DATAFORSEO_LOGIN und DATAFORSEO_PASSWORD in Vercel → Settings → Environment Variables.',
      }, { status: 401 })
    }
    if (code === 40201) {
      return NextResponse.json({
        error: 'DataForSEO Guthaben aufgebraucht. Bitte lade dein Konto auf dataforseo.com auf.',
      }, { status: 402 })
    }
    return NextResponse.json({
      error: `DataForSEO Fehler (Code ${code}): ${msg}`,
    }, { status: 500 })
  }

  const summary          = summaryData?.tasks?.[0]?.result?.[0]  || null
  const backlinks        = backlinksData?.tasks?.[0]?.result?.[0]?.items || []
  const referringDomains = domainsData?.tasks?.[0]?.result?.[0]?.items  || []
  const anchors          = anchorsData?.tasks?.[0]?.result?.[0]?.items  || []

  // Keine Daten gefunden
  if (!summary && backlinks.length === 0) {
    return NextResponse.json({
      error: `Keine Backlink-Daten für "${cleanDomain}" gefunden. Entweder hat die Domain sehr wenige Backlinks oder die Backlinks API ist noch nicht aktiviert.`,
    }, { status: 404 })
  }

  return NextResponse.json({
    domain: cleanDomain,
    summary: summary ? {
      rank:             summary.rank              || 0,
      backlinks:        summary.backlinks         || 0,
      dofollow:         summary.dofollow          || 0,
      nofollow:         summary.nofollow          || 0,
      referringDomains: summary.referring_domains || 0,
      brokenBacklinks:  summary.broken_backlinks  || 0,
      spamScore:        summary.spam_score        || 0,
    } : null,
    topBacklinks: backlinks.slice(0, 20).map(item => ({
      url:        item.url_from,
      domain:     item.domain_from,
      anchorText: item.anchor,
      rank:       item.rank,
      dofollow:   item.dofollow,
      firstSeen:  item.first_seen?.split('T')[0] || null,
    })),
    referringDomains: referringDomains.slice(0, 15).map(item => ({
      domain:    item.domain,
      rank:      item.rank,
      backlinks: item.backlinks,
      dofollow:  item.dofollow,
      country:   item.country,
    })),
    anchors: anchors.slice(0, 10).map(item => ({
      anchor:    item.anchor || '(kein Ankertext)',
      backlinks: item.backlinks,
      dofollow:  item.dofollow,
    })),
  })
}
