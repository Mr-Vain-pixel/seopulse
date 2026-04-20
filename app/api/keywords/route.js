import { NextResponse } from 'next/server'

// DataForSEO Location Codes (zuverlässiger als location_name)
const LOCATIONS = {
  'Switzerland': { code: 2756, domain: 'google.ch', lang: 'German', langCode: 'de' },
  'Germany':     { code: 2276, domain: 'google.de', lang: 'German', langCode: 'de' },
  'Austria':     { code: 2040, domain: 'google.at', lang: 'German', langCode: 'de' },
  'United States': { code: 2840, domain: 'google.com', lang: 'English', langCode: 'en' },
}

export async function POST(request) {
  const { keyword, location = 'Switzerland' } = await request.json()

  if (!keyword?.trim()) {
    return NextResponse.json({ error: 'Kein Keyword angegeben.' }, { status: 400 })
  }

  const DFS_LOGIN    = process.env.DATAFORSEO_LOGIN
  const DFS_PASSWORD = process.env.DATAFORSEO_PASSWORD

  if (!DFS_LOGIN || !DFS_PASSWORD) {
    return NextResponse.json({
      error: 'DataForSEO API-Zugangsdaten fehlen. Bitte in Vercel → Settings → Environment Variables eintragen und Redeploy starten.',
    }, { status: 500 })
  }

  const loc = LOCATIONS[location] || LOCATIONS['Switzerland']
  const auth = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64')
  const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }

  // Alle Calls parallel – mit individuellem Error-Catching
  const [overviewRes, ideasRes, serpRes] = await Promise.allSettled([

    // 1. Suchvolumen & CPC via Google Ads API
    fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
      method: 'POST', headers,
      body: JSON.stringify([{
        keywords: [keyword.trim()],
        location_code: loc.code,
        language_code: loc.langCode,
      }]),
    }).then(r => r.json()),

    // 2. Keyword-Ideen via DataForSEO Labs
    fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live', {
      method: 'POST', headers,
      body: JSON.stringify([{
        keywords: [keyword.trim()],
        location_code: loc.code,
        language_code: loc.langCode,
        limit: 20,
      }]),
    }).then(r => r.json()),

    // 3. SERP Top 10
    fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST', headers,
      body: JSON.stringify([{
        keyword: keyword.trim(),
        location_code: loc.code,
        language_code: loc.langCode,
        depth: 10,
        se_domain: loc.domain,
      }]),
    }).then(r => r.json()),
  ])

  // Sicher auslesen
  const overviewData = overviewRes.status === 'fulfilled' ? overviewRes.value : null
  const ideasData    = ideasRes.status    === 'fulfilled' ? ideasRes.value    : null
  const serpData     = serpRes.status     === 'fulfilled' ? serpRes.value     : null

  // DataForSEO API-Fehler prüfen (z.B. falsches Login)
  const task0 = overviewData?.tasks?.[0]
  if (task0 && task0.status_code !== 20000) {
    return NextResponse.json({
      error: `DataForSEO Fehler (Code ${task0.status_code}): ${task0.status_message}`,
    }, { status: 500 })
  }

  const kwData    = overviewData?.tasks?.[0]?.result?.[0] || null
  const ideas     = ideasData?.tasks?.[0]?.result?.[0]?.items || []
  const serpItems = serpData?.tasks?.[0]?.result?.[0]?.items || []

  const topResults = serpItems
    .filter(item => item.type === 'organic')
    .slice(0, 5)
    .map(item => ({
      position:    item.rank_absolute,
      title:       item.title,
      url:         item.url,
      description: item.description,
      domain:      item.domain,
    }))

  return NextResponse.json({
    keyword,
    overview: kwData ? {
      searchVolume:     kwData.search_volume     || 0,
      cpc:              kwData.cpc               || 0,
      competition:      kwData.competition       || 0,
      competitionLevel: kwData.competition_level || 'n/a',
    } : null,
    ideas: ideas.slice(0, 20).map(item => ({
      keyword:          item.keyword,
      searchVolume:     item.keyword_info?.search_volume               || 0,
      cpc:              item.keyword_info?.cpc                         || 0,
      difficulty:       item.keyword_properties?.keyword_difficulty    || 0,
      competitionLevel: item.keyword_info?.competition_level           || 'n/a',
    })),
    serpTop5: topResults,
  })
}
