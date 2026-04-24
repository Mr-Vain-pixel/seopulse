import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import axios from 'axios'
import { createClient } from '@/lib/supabase-server'

export async function POST(request) {
  const { url, save = false } = await request.json()

  if (!url) {
    return NextResponse.json({ error: 'Keine URL angegeben.' }, { status: 400 })
  }

  // Auth + Nutzungslimit prüfen
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const today = new Date().toISOString().split('T')[0]
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profile && profile.plan !== 'pro') {
      const lastDate = profile.last_analysis_date?.split('T')[0]
      const usedToday = lastDate === today ? (profile.analyses_today || 0) : 0
      if (usedToday >= 3) {
        return NextResponse.json({
          error: 'Tageslimit erreicht. Du hast heute bereits 3 Analysen durchgeführt. Upgrade auf Pro für unlimitierte Analysen.',
          limitReached: true,
        }, { status: 429 })
      }
      await supabase.from('profiles').upsert({
        id: user.id,
        analyses_today: lastDate === today ? usedToday + 1 : 1,
        last_analysis_date: new Date().toISOString(),
      })
    }
  }

  let fullUrl = url.trim()
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    fullUrl = 'https://' + fullUrl
  }

  let html = ''
  let responseTime = 0
  let finalUrl = fullUrl
  let statusCode = 0

  try {
    const start = Date.now()
    const response = await axios.get(fullUrl, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'SEOPulse-Bot/1.0 (SEO Analysis Tool)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    responseTime = Date.now() - start
    html = response.data
    finalUrl = response.request.res?.responseUrl || fullUrl
    statusCode = response.status
  } catch (err) {
    return NextResponse.json({
      error: `Website konnte nicht erreicht werden: ${err.message}`,
    }, { status: 422 })
  }

  const $ = cheerio.load(html)
  const issues = []
  const passed = []

  // Helper: absolute URL aus relativem Pfad
  const toAbsolute = (src) => {
    if (!src) return null
    if (src.startsWith('http')) return src
    try {
      return new URL(src, finalUrl).href
    } catch {
      return src
    }
  }

  // --- Title ---
  const title = $('title').first().text().trim()
  if (!title) {
    issues.push({
      severity: 'critical',
      title: 'Kein Seitentitel (Title-Tag)',
      detail: 'Der Title-Tag fehlt komplett. Er ist eines der wichtigsten On-Page SEO-Elemente.',
      fix: 'Füge einen <title>-Tag im <head> ein, z.B.: <title>Dein Seitenname – Kurze Beschreibung</title>',
    })
  } else if (title.length < 30) {
    issues.push({
      severity: 'warning',
      title: `Title zu kurz (${title.length} Zeichen)`,
      detail: `Empfohlen: 50–60 Zeichen. Kurze Titel werden in Suchergebnissen weniger gut bewertet.`,
      items: [`Aktueller Title: "${title}"`],
      fix: 'Erweitere den Title auf 50–60 Zeichen mit dem Haupt-Keyword am Anfang.',
    })
  } else if (title.length > 60) {
    issues.push({
      severity: 'warning',
      title: `Title zu lang (${title.length} Zeichen)`,
      detail: `Wird in Suchergebnissen nach ca. 60 Zeichen abgeschnitten.`,
      items: [`Aktueller Title: "${title}"`, `In Google sichtbar: "${title.slice(0, 60)}…"`],
      fix: 'Kürze den Title auf maximal 60 Zeichen. Wichtigste Keywords an den Anfang.',
    })
  } else {
    passed.push({ title: `Title-Tag vorhanden (${title.length} Zeichen)`, detail: `"${title}"` })
  }

  // --- Meta Description ---
  const metaDesc = $('meta[name="description"]').attr('content') || ''
  if (!metaDesc) {
    issues.push({
      severity: 'critical',
      title: 'Meta-Description fehlt',
      detail: 'Eine fehlende Meta-Description reduziert die Klickrate in Suchergebnissen erheblich.',
      fix: 'Füge im <head> ein: <meta name="description" content="Kurze Beschreibung deiner Seite (150–160 Zeichen)">',
    })
  } else if (metaDesc.length < 70) {
    issues.push({
      severity: 'warning',
      title: `Meta-Description zu kurz (${metaDesc.length} Zeichen)`,
      detail: 'Empfohlen: 150–160 Zeichen. Zu kurze Descriptions werden oft von Google überschrieben.',
      items: [`Aktuell: "${metaDesc}"`],
      fix: 'Erweitere die Description auf 150–160 Zeichen mit relevanten Keywords und einem Call-to-Action.',
    })
  } else if (metaDesc.length > 160) {
    issues.push({
      severity: 'warning',
      title: `Meta-Description zu lang (${metaDesc.length} Zeichen)`,
      detail: 'Wird in Suchergebnissen nach ca. 160 Zeichen abgeschnitten.',
      items: [`Aktuell (${metaDesc.length} Zeichen): "${metaDesc.slice(0, 100)}…"`, `In Google sichtbar: "${metaDesc.slice(0, 160)}…"`],
      fix: 'Kürze die Meta-Description auf maximal 160 Zeichen.',
    })
  } else {
    passed.push({ title: `Meta-Description vorhanden (${metaDesc.length} Zeichen)`, detail: `"${metaDesc}"` })
  }

  // --- H1 ---
  const h1Tags = $('h1')
  const h1Texts = []
  h1Tags.each((_, el) => {
    const text = $(el).text().trim()
    if (text) h1Texts.push(text)
  })

  if (h1Tags.length === 0) {
    issues.push({
      severity: 'critical',
      title: 'Kein H1-Tag gefunden',
      detail: 'Jede Seite sollte genau einen H1-Tag mit dem Haupt-Keyword enthalten.',
      fix: 'Füge einen <h1>-Tag mit dem wichtigsten Keyword der Seite ein. Er sollte nur einmal vorkommen.',
    })
  } else if (h1Tags.length > 1) {
    issues.push({
      severity: 'warning',
      title: `Mehrere H1-Tags gefunden (${h1Tags.length}×)`,
      detail: 'Es sollte pro Seite genau ein H1-Tag vorhanden sein. Mehrere H1s verwirren Suchmaschinen.',
      items: h1Texts.slice(0, 5).map((t, i) => `H1 #${i + 1}: "${t.slice(0, 80)}${t.length > 80 ? '…' : ''}"`),
      fix: 'Behalte nur den wichtigsten H1-Tag. Ändere die anderen auf H2 oder H3.',
    })
  } else {
    passed.push({ title: 'H1-Tag vorhanden (1×)', detail: `"${h1Texts[0]?.slice(0, 100) || ''}"` })
  }

  // --- H2 ---
  const h2Tags = $('h2')
  const h2Texts = []
  h2Tags.each((_, el) => {
    const text = $(el).text().trim()
    if (text) h2Texts.push(text)
  })

  if (h2Tags.length === 0) {
    issues.push({
      severity: 'warning',
      title: 'Keine H2-Überschriften gefunden',
      detail: 'H2-Tags strukturieren den Inhalt und helfen Suchmaschinen beim Verstehen der Seitenstruktur.',
      fix: 'Teile den Seiteninhalt in Abschnitte auf und kennzeichne diese mit <h2>-Tags.',
    })
  } else {
    passed.push({
      title: `${h2Tags.length} H2-Überschriften gefunden`,
      detail: h2Texts.slice(0, 3).map(t => `"${t.slice(0, 60)}"`).join(' · ') + (h2Texts.length > 3 ? ` · +${h2Texts.length - 3} weitere` : ''),
    })
  }

  // --- Images Alt Text ---
  const allImages = $('img')
  const imagesWithoutAlt = []
  const imagesWithAlt = []

  allImages.each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || ''
    const alt = $(el).attr('alt')
    const absUrl = toAbsolute(src)
    if (!alt || alt.trim() === '') {
      imagesWithoutAlt.push(absUrl || src)
    } else {
      imagesWithAlt.push({ src: absUrl || src, alt })
    }
  })

  if (imagesWithoutAlt.length > 0) {
    issues.push({
      severity: imagesWithoutAlt.length > 5 ? 'critical' : 'warning',
      title: `${imagesWithoutAlt.length} von ${allImages.length} Bildern ohne Alt-Text`,
      detail: 'Alt-Texte sind wichtig für Barrierefreiheit, Bildsuche und SEO-Bewertung.',
      items: imagesWithoutAlt.slice(0, 8).map(src => src ? (src.length > 80 ? '…' + src.slice(-80) : src) : '(kein src-Attribut)'),
      fix: 'Füge jedem <img>-Tag ein alt=""-Attribut mit einer kurzen Bildbeschreibung hinzu. Dekorative Bilder erhalten alt="".',
    })
  } else if (allImages.length > 0) {
    passed.push({ title: `Alle ${allImages.length} Bilder haben Alt-Text`, detail: 'Gut für Barrierefreiheit und Bildsuche.' })
  }

  // --- Links ohne Text (Anchor Text) ---
  const emptyLinks = []
  $('a').each((_, el) => {
    const text = $(el).text().trim()
    const hasImg = $(el).find('img[alt]').length > 0
    const href = $(el).attr('href') || ''
    if (!text && !hasImg && href && !href.startsWith('#')) {
      emptyLinks.push(href)
    }
  })
  if (emptyLinks.length > 0) {
    issues.push({
      severity: 'warning',
      title: `${emptyLinks.length} Links ohne Ankertext`,
      detail: 'Links ohne beschreibenden Text helfen Suchmaschinen nicht beim Verstehen der verlinkten Seite.',
      items: emptyLinks.slice(0, 5).map(h => `href="${h.slice(0, 80)}"`),
      fix: 'Füge jedem <a>-Tag einen beschreibenden Linktext hinzu, z.B. <a href="...">Mehr über unsere Leistungen</a>.',
    })
  }

  // --- SSL ---
  if (finalUrl.startsWith('https://')) {
    passed.push({ title: 'HTTPS / SSL aktiv', detail: 'Die Website verwendet eine sichere Verbindung.' })
  } else {
    issues.push({
      severity: 'critical',
      title: 'Kein HTTPS / SSL',
      detail: 'Die Website verwendet kein SSL-Zertifikat. Google bevorzugt HTTPS-Seiten und markiert HTTP-Seiten als "Nicht sicher".',
      fix: 'Installiere ein SSL-Zertifikat (z.B. kostenlos via Let\'s Encrypt) und leite HTTP auf HTTPS um.',
    })
  }

  // --- Canonical ---
  const canonical = $('link[rel="canonical"]').attr('href')
  if (canonical) {
    passed.push({ title: 'Canonical-Tag gesetzt', detail: canonical })
  } else {
    issues.push({
      severity: 'warning',
      title: 'Kein Canonical-Tag',
      detail: 'Canonical-Tags verhindern Duplicate-Content-Probleme wenn die gleiche Seite unter mehreren URLs erreichbar ist.',
      fix: `Füge im <head> ein: <link rel="canonical" href="${finalUrl}">`,
    })
  }

  // --- Robots Meta ---
  const robotsMeta = $('meta[name="robots"]').attr('content') || ''
  if (robotsMeta.includes('noindex')) {
    issues.push({
      severity: 'critical',
      title: 'Seite auf NOINDEX gesetzt',
      detail: 'Die Seite wird von Suchmaschinen NICHT indexiert und erscheint nicht in Suchergebnissen!',
      items: [`Meta-Robots Inhalt: "${robotsMeta}"`],
      fix: 'Entferne "noindex" aus dem Meta-Robots-Tag oder ändere es zu <meta name="robots" content="index, follow">.',
    })
  } else {
    passed.push({ title: 'Seite ist indexierbar', detail: robotsMeta ? `Meta-Robots: "${robotsMeta}"` : 'Kein Noindex-Tag gefunden.' })
  }

  // --- Structured Data ---
  const schemaScripts = $('script[type="application/ld+json"]')
  const schemaTypes = []
  schemaScripts.each((_, el) => {
    try {
      const json = JSON.parse($(el).html())
      const type = json['@type'] || json['@graph']?.[0]?.['@type']
      if (type) schemaTypes.push(type)
    } catch {}
  })

  if (schemaScripts.length > 0) {
    passed.push({
      title: `Strukturierte Daten vorhanden (${schemaScripts.length} Block${schemaScripts.length > 1 ? 'ö' : 'ö'}cke)`,
      detail: schemaTypes.length > 0 ? `Gefundene Typen: ${schemaTypes.join(', ')}` : 'Schema.org-Markup gefunden.',
    })
  } else {
    issues.push({
      severity: 'warning',
      title: 'Keine strukturierten Daten (Schema.org)',
      detail: 'Schema.org-Markup ermöglicht Rich Snippets in Suchergebnissen und verbessert die Sichtbarkeit.',
      fix: 'Füge passende Schema.org-Typen hinzu, z.B. Organization, WebSite, BreadcrumbList oder FAQPage. Generator: schema.org',
    })
  }

  // --- Open Graph ---
  const ogTitle = $('meta[property="og:title"]').attr('content')
  const ogDescription = $('meta[property="og:description"]').attr('content')
  const ogImage = $('meta[property="og:image"]').attr('content')
  const ogUrl = $('meta[property="og:url"]').attr('content')
  const missingOg = []
  if (!ogTitle) missingOg.push('og:title')
  if (!ogDescription) missingOg.push('og:description')
  if (!ogImage) missingOg.push('og:image')
  if (!ogUrl) missingOg.push('og:url')

  if (missingOg.length === 0) {
    passed.push({ title: 'Open Graph Tags vollständig', detail: `og:title, og:description, og:image, og:url – perfekte Social-Media-Vorschau.` })
  } else if (missingOg.length <= 2) {
    issues.push({
      severity: 'warning',
      title: `Open Graph Tags unvollständig (${missingOg.length} fehlen)`,
      detail: 'Open Graph Tags steuern wie die Seite beim Teilen auf Facebook, LinkedIn etc. aussieht.',
      items: missingOg.map(tag => `Fehlt: <meta property="${tag}" content="...">`),
      fix: 'Ergänze die fehlenden Open Graph Tags im <head> der Seite.',
    })
  } else {
    issues.push({
      severity: 'warning',
      title: 'Open Graph Tags fehlen grösstenteils',
      detail: 'Ohne OG-Tags sieht die Seite beim Teilen auf Social Media unprofessionell aus.',
      items: missingOg.map(tag => `Fehlt: <meta property="${tag}" content="...">`),
      fix: 'Füge alle wichtigen Open Graph Tags im <head> ein: og:title, og:description, og:image, og:url.',
    })
  }

  // --- Ladezeit ---
  if (responseTime < 1500) {
    passed.push({ title: `Schnelle Ladezeit (${responseTime}ms)`, detail: 'Unter 1.5 Sekunden – ausgezeichnet für SEO und Nutzererfahrung.' })
  } else if (responseTime < 3000) {
    issues.push({
      severity: 'warning',
      title: `Ladezeit optimierbar (${responseTime}ms)`,
      detail: 'Ladezeit beeinflusst Google-Rankings (Core Web Vitals). Ziel ist unter 1.5 Sekunden.',
      items: [`Server-Antwortzeit: ${responseTime}ms`, 'Zielwert: unter 1500ms'],
      fix: 'Optimiere Bilder (WebP-Format), aktiviere Browser-Caching, nutze ein CDN und minimiere CSS/JS.',
    })
  } else {
    issues.push({
      severity: 'critical',
      title: `Ladezeit zu hoch (${responseTime}ms)`,
      detail: 'Über 3 Sekunden ist ein stark negativer Ranking-Faktor. Viele Nutzer verlassen die Seite vorher.',
      items: [`Server-Antwortzeit: ${responseTime}ms`, 'Zielwert: unter 1500ms', 'Kritisch: über 3000ms'],
      fix: 'Dringend: Optimiere Hosting, aktiviere Komprimierung (gzip/brotli), reduziere Bildgrössen und minimiere Requests.',
    })
  }

  // --- Viewport (Mobile) ---
  const viewport = $('meta[name="viewport"]').attr('content')
  if (viewport) {
    passed.push({ title: 'Viewport-Tag vorhanden (Mobile-freundlich)', detail: `content="${viewport}"` })
  } else {
    issues.push({
      severity: 'warning',
      title: 'Kein Viewport-Tag (Mobile)',
      detail: 'Ohne Viewport-Tag wird die Seite auf Mobilgeräten nicht korrekt dargestellt. Google bewertet Mobile-Freundlichkeit stark.',
      fix: 'Füge im <head> ein: <meta name="viewport" content="width=device-width, initial-scale=1">',
    })
  }

  // --- Broken Links (interne Links prüfen, max. 10) ---
  const internalLinks = []
  const baseHost = new URL(finalUrl).hostname
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    try {
      const abs = new URL(href, finalUrl)
      if (abs.hostname === baseHost && !internalLinks.includes(abs.href)) {
        internalLinks.push(abs.href)
      }
    } catch {}
  })

  // Überprüfe bis zu 8 interne Links
  const brokenLinks = []
  const linkCheckPromises = internalLinks.slice(0, 8).map(async (link) => {
    try {
      const res = await axios.head(link, {
        timeout: 5000,
        maxRedirects: 3,
        headers: { 'User-Agent': 'SEOPulse-Bot/1.0' },
        validateStatus: () => true,
      })
      if (res.status === 404 || res.status === 410) {
        brokenLinks.push({ url: link, status: res.status })
      }
    } catch {}
  })
  await Promise.all(linkCheckPromises)

  if (brokenLinks.length > 0) {
    issues.push({
      severity: 'critical',
      title: `${brokenLinks.length} defekte interne Link${brokenLinks.length > 1 ? 's' : ''} gefunden`,
      detail: 'Defekte Links (404/410) schaden dem Nutzererlebnis und können das Crawling durch Google beeinträchtigen.',
      items: brokenLinks.map(l => `${l.status} – ${l.url.length > 80 ? '…' + l.url.slice(-80) : l.url}`),
      fix: 'Aktualisiere oder entferne die defekten Links. Leite 404-Seiten mit 301-Weiterleitungen auf relevante Seiten um.',
    })
  } else if (internalLinks.length > 0) {
    passed.push({ title: `Interne Links geprüft (${Math.min(internalLinks.length, 8)} von ${internalLinks.length})`, detail: 'Keine defekten Links (404/410) gefunden.' })
  }

  // --- Score berechnen ---
  const criticalCount = issues.filter(i => i.severity === 'critical').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const totalChecks = issues.length + passed.length
  const score = Math.max(0, Math.round(100 - (criticalCount * 15) - (warningCount * 5)))

  const result = {
    url: finalUrl,
    score,
    title: title || null,
    metaDescription: metaDesc || null,
    responseTime,
    statusCode,
    issues,
    passed,
    summary: {
      critical: criticalCount,
      warnings: warningCount,
      passed: passed.length,
      total: totalChecks,
    },
  }

  // Analyse speichern wenn User eingeloggt und save=true
  if (user && save) {
    await supabase.from('analyses').insert({
      user_id: user.id,
      url: finalUrl,
      score,
      issues_critical: criticalCount,
      issues_warnings: warningCount,
      result_json: result,
    })
  }

  return NextResponse.json({ ...result, isLoggedIn: !!user })
}
