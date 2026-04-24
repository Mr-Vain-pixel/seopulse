'use client'
import { useState, useEffect } from 'react'
import styles from './page.module.css'
import { createClient } from '@/lib/supabase-browser'

// ── Shared Helpers ────────────────────────────────────────────────────────────
const severityColor = { critical: '#E24B4A', warning: '#EF9F27' }
const severityLabel = { critical: 'Kritisch', warning: 'Warnung' }

const LOCATIONS = {
  'Switzerland':   '🇨🇭 Schweiz',
  'Germany':       '🇩🇪 Deutschland',
  'Austria':       '🇦🇹 Österreich',
  'United States': '🇺🇸 USA',
}

function ScoreCircle({ score }) {
  const r = 54, c = 2 * Math.PI * r
  const color = score >= 70 ? '#1D9E75' : score >= 40 ? '#EF9F27' : '#E24B4A'
  return (
    <div className={styles.scoreCircleWrap}>
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="#E5E5E2" strokeWidth="10" />
        <circle cx="65" cy="65" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={c} strokeDashoffset={c - (score / 100) * c}
          strokeLinecap="round" transform="rotate(-90 65 65)"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className={styles.scoreInner}>
        <span className={styles.scoreNum} style={{ color }}>{score}</span>
        <span className={styles.scoreLabel}>{score >= 70 ? 'Gut' : score >= 40 ? 'Verbesserungsbedarf' : 'Kritisch'}</span>
      </div>
    </div>
  )
}

function DifficultyBar({ value }) {
  const color = value < 30 ? '#1D9E75' : value < 60 ? '#EF9F27' : '#E24B4A'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: '#F0F0EE', borderRadius: 99 }}>
        <div style={{ width: `${Math.min(value, 100)}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 500, minWidth: 28 }}>{value}</span>
    </div>
  )
}

function CompetitionBadge({ level }) {
  const map = { LOW: ['#E1F5EE','#0F6E56','Tief'], MEDIUM: ['#FAEEDA','#854F0B','Mittel'], HIGH: ['#FCEBEB','#A32D2D','Hoch'] }
  const [bg, color, label] = map[level?.toUpperCase()] || ['#F0F0EE','#666', level || 'n/a']
  return <span style={{ background: bg, color, fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 500 }}>{label}</span>
}

function LoadingBar({ text }) {
  return (
    <div className={styles.loadingWrap}>
      <div className={styles.loadingBar}><div className={styles.loadingFill} /></div>
      <p className={styles.loadingText}>{text}</p>
    </div>
  )
}

function ErrorBox({ message }) {
  return <div className={styles.errorBox}><strong>Fehler:</strong> {message}</div>
}

function SectionCard({ title, badge, children }) {
  return (
    <div className={styles.sectionCard}>
      <h3 className={styles.sectionTitle}>{title}{badge}</h3>
      {children}
    </div>
  )
}

// ── Tab 1: SEO Analyse ────────────────────────────────────────────────────────
function AnalyseTab({ user }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true); setResult(null); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/analyse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), save: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler')
      setResult(data)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  async function handleSave() {
    if (!result || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/analyse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: result.url, save: true }),
      })
      if (res.ok) setSaved(true)
    } catch {}
    setSaving(false)
  }

  return (
    <div>
      <form className={styles.searchBar} onSubmit={handleSubmit}>
        <input type="text" className={styles.urlInput} placeholder="https://deine-website.ch"
          value={url} onChange={e => setUrl(e.target.value)} />
        <button type="submit" className={styles.btnPrimary} disabled={loading}>
          {loading ? 'Analysiere…' : 'Analysieren'}
        </button>
      </form>
      {loading && <LoadingBar text="Website wird analysiert…" />}
      {error && <ErrorBox message={error} />}
      {result && (
        <div className={styles.resultsWrap}>
          <div className={styles.scoreCard}>
            <ScoreCircle score={result.score} />
            <div className={styles.scoreInfo}>
              <h2>SEO-Gesamtscore</h2>
              <p className={styles.scoreUrl}>{result.url}</p>
              <p className={styles.scoreTime}>Analysezeit: {result.responseTime}ms · Status: {result.statusCode}</p>
              {user ? (
                saved ? (
                  <span className={styles.savedBadge}>✓ Gespeichert</span>
                ) : (
                  <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                    {saving ? 'Speichern…' : '+ Im Dashboard speichern'}
                  </button>
                )
              ) : (
                <a href="/auth" className={styles.saveBtn}>Anmelden um zu speichern</a>
              )}
            </div>
          </div>
          <div className={styles.metricsGrid}>
            {[
              { label: 'Kritische Fehler', value: result.summary.critical, color: result.summary.critical > 0 ? '#E24B4A' : '#1D9E75' },
              { label: 'Warnungen', value: result.summary.warnings, color: result.summary.warnings > 0 ? '#EF9F27' : '#1D9E75' },
              { label: 'Bestanden', value: result.summary.passed, color: '#1D9E75' },
              { label: 'Ladezeit', value: `${(result.responseTime/1000).toFixed(2)}s`, color: result.responseTime < 1500 ? '#1D9E75' : result.responseTime < 3000 ? '#EF9F27' : '#E24B4A' },
            ].map((m, i) => (
              <div key={i} className={styles.metricCard}>
                <span className={styles.mLabel}>{m.label}</span>
                <span className={styles.mValue} style={{ color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>
          {result.issues.length > 0 && (
            <SectionCard title="Gefundene Probleme" badge={
              <>{result.summary.critical > 0 && <span className={styles.badgeErr}>{result.summary.critical} kritisch</span>}
              {result.summary.warnings > 0 && <span className={styles.badgeWarn}>{result.summary.warnings} Warnungen</span>}</>
            }>
              {result.issues.map((issue, i) => (
                <div key={i} className={styles.issueItem}>
                  <div className={styles.issueDot} style={{ background: severityColor[issue.severity] }} />
                  <div style={{ flex: 1 }}>
                    <p className={styles.issueTitle}>
                      <span className={styles.issueBadge} style={{ background: issue.severity === 'critical' ? '#FCEBEB' : '#FAEEDA', color: issue.severity === 'critical' ? '#A32D2D' : '#854F0B' }}>
                        {severityLabel[issue.severity]}
                      </span>
                      {issue.title}
                    </p>
                    <p className={styles.issueDetail}>{issue.detail}</p>
                    {issue.items?.length > 0 && (
                      <ul className={styles.issueItems}>
                        {issue.items.map((item, j) => <li key={j} className={styles.issueItemLine}>{item}</li>)}
                      </ul>
                    )}
                    {issue.fix && <div className={styles.issueFix}><span className={styles.issueFixLabel}>Empfehlung: </span>{issue.fix}</div>}
                  </div>
                </div>
              ))}
            </SectionCard>
          )}
          {result.passed.length > 0 && (
            <SectionCard title="Bestandene Checks" badge={<span className={styles.badgeOk}>{result.passed.length} ok</span>}>
              <div className={styles.checksGrid}>
                {result.passed.map((item, i) => (
                  <div key={i} className={styles.checkItem}>
                    <span className={styles.checkIcon}>✓</span>
                    <div><p className={styles.checkTitle}>{item.title}</p><p className={styles.checkDetail}>{item.detail}</p></div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab 2: Keyword-Recherche ──────────────────────────────────────────────────
function KeywordsTab() {
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState('Switzerland')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!keyword.trim()) return
    setLoading(true); setResult(null); setError(null)
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), location }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler')
      setResult(data)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return (
    <div>
      <form className={styles.searchBar} onSubmit={handleSubmit}>
        <input type="text" className={styles.urlInput} placeholder="Keyword eingeben, z.B. SEO Agentur Zürich"
          value={keyword} onChange={e => setKeyword(e.target.value)} />
        <select className={styles.selectInput} value={location} onChange={e => setLocation(e.target.value)}>
          {Object.entries(LOCATIONS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <button type="submit" className={styles.btnPrimary} disabled={loading}>
          {loading ? 'Suche…' : 'Recherchieren'}
        </button>
      </form>
      {loading && <LoadingBar text="Keyword-Daten werden geladen…" />}
      {error && <ErrorBox message={error} />}
      {result && (
        <div className={styles.resultsWrap}>
          {result.overview && (
            <div className={styles.metricsGrid}>
              {[
                { label: 'Suchvolumen/Monat', value: result.overview.searchVolume.toLocaleString('de-CH') },
                { label: 'CPC', value: `CHF ${result.overview.cpc.toFixed(2)}` },
                { label: 'Wettbewerb', value: <CompetitionBadge level={result.overview.competitionLevel} /> },
                { label: 'Keyword-Ideen', value: result.ideas.length },
              ].map((m, i) => (
                <div key={i} className={styles.metricCard}>
                  <span className={styles.mLabel}>{m.label}</span>
                  <span className={styles.mValue}>{m.value}</span>
                </div>
              ))}
            </div>
          )}
          {result.serpTop5?.length > 0 && (
            <SectionCard title={`Top 5 Google-Ergebnisse für „${result.keyword}"`}>
              {result.serpTop5.map((item, i) => (
                <div key={i} className={styles.serpItem}>
                  <div className={styles.serpPos}>{item.position}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className={styles.serpTitle}>{item.title}</p>
                    <p className={styles.serpUrl}>{item.url}</p>
                    {item.description && <p className={styles.serpDesc}>{item.description}</p>}
                  </div>
                </div>
              ))}
            </SectionCard>
          )}
          {result.ideas?.length > 0 && (
            <SectionCard title="Verwandte Keywords" badge={<span className={styles.badgeOk}>{result.ideas.length} gefunden</span>}>
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr><th>Keyword</th><th>Volumen/Monat</th><th>CPC</th><th>Schwierigkeit</th><th>Wettbewerb</th></tr>
                  </thead>
                  <tbody>
                    {result.ideas.map((idea, i) => (
                      <tr key={i}>
                        <td className={styles.kwCell}>{idea.keyword}</td>
                        <td>{idea.searchVolume.toLocaleString('de-CH')}</td>
                        <td>CHF {idea.cpc.toFixed(2)}</td>
                        <td style={{ minWidth: 120 }}><DifficultyBar value={idea.difficulty} /></td>
                        <td><CompetitionBadge level={idea.competitionLevel} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab 3: Backlink-Analyse ───────────────────────────────────────────────────
function BacklinksTab() {
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!domain.trim()) return
    setLoading(true); setResult(null); setError(null)
    try {
      const res = await fetch('/api/backlinks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler')
      setResult(data)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return (
    <div>
      <form className={styles.searchBar} onSubmit={handleSubmit}>
        <input type="text" className={styles.urlInput} placeholder="domain.ch oder https://domain.ch"
          value={domain} onChange={e => setDomain(e.target.value)} />
        <button type="submit" className={styles.btnPrimary} disabled={loading}>
          {loading ? 'Analysiere…' : 'Backlinks prüfen'}
        </button>
      </form>
      {loading && <LoadingBar text="Backlink-Profil wird geladen…" />}
      {error && <ErrorBox message={error} />}
      {result && (
        <div className={styles.resultsWrap}>
          {result.summary && (
            <div className={styles.metricsGrid} style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
              {[
                { label: 'Domain Rank', value: result.summary.rank },
                { label: 'Total Backlinks', value: result.summary.backlinks.toLocaleString('de-CH') },
                { label: 'Dofollow Links', value: result.summary.dofollow.toLocaleString('de-CH') },
                { label: 'Nofollow Links', value: result.summary.nofollow.toLocaleString('de-CH') },
                { label: 'Referring Domains', value: result.summary.referringDomains.toLocaleString('de-CH') },
                { label: 'Spam Score', value: `${result.summary.spamScore}%`, color: result.summary.spamScore > 30 ? '#E24B4A' : result.summary.spamScore > 10 ? '#EF9F27' : '#1D9E75' },
              ].map((m, i) => (
                <div key={i} className={styles.metricCard}>
                  <span className={styles.mLabel}>{m.label}</span>
                  <span className={styles.mValue} style={{ color: m.color }}>{m.value}</span>
                </div>
              ))}
            </div>
          )}
          {result.referringDomains?.length > 0 && (
            <SectionCard title="Top Referring Domains" badge={<span className={styles.badgeOk}>{result.referringDomains.length}</span>}>
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead><tr><th>Domain</th><th>Rank</th><th>Backlinks</th><th>Dofollow</th><th>Land</th></tr></thead>
                  <tbody>
                    {result.referringDomains.map((d, i) => (
                      <tr key={i}>
                        <td className={styles.kwCell}><a href={`https://${d.domain}`} target="_blank" rel="noopener">{d.domain}</a></td>
                        <td>{d.rank}</td><td>{d.backlinks}</td><td>{d.dofollow}</td><td>{d.country || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
          {result.anchors?.length > 0 && (
            <SectionCard title="Häufigste Ankertexte">
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead><tr><th>Ankertext</th><th>Backlinks</th><th>Dofollow</th></tr></thead>
                  <tbody>
                    {result.anchors.map((a, i) => (
                      <tr key={i}><td className={styles.kwCell}>{a.anchor}</td><td>{a.backlinks}</td><td>{a.dofollow}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
          {result.topBacklinks?.length > 0 && (
            <SectionCard title="Stärkste Backlinks (Dofollow)">
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead><tr><th>Von</th><th>Ankertext</th><th>Rank</th><th>Typ</th><th>Entdeckt</th></tr></thead>
                  <tbody>
                    {result.topBacklinks.map((bl, i) => (
                      <tr key={i}>
                        <td className={styles.kwCell}><a href={bl.url} target="_blank" rel="noopener" title={bl.url}>{bl.domain}</a></td>
                        <td>{bl.anchorText || '–'}</td>
                        <td>{bl.rank}</td>
                        <td><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 500, background: bl.dofollow ? '#E1F5EE' : '#F3F3F1', color: bl.dofollow ? '#0F6E56' : '#666' }}>{bl.dofollow ? 'dofollow' : 'nofollow'}</span></td>
                        <td style={{ fontSize: 12, color: '#888' }}>{bl.firstSeen || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tab 4: URL-Prüfung ────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  ok:        { color: '#1D9E75', bg: '#E1F5EE', label: '200 OK' },
  redirect:  { color: '#185FA5', bg: '#E6F1FB', label: 'Weiterleitung' },
  not_found: { color: '#A32D2D', bg: '#FCEBEB', label: '404 Nicht gefunden' },
  forbidden: { color: '#854F0B', bg: '#FAEEDA', label: '403 Verboten' },
  error:     { color: '#A32D2D', bg: '#FCEBEB', label: 'Server-Fehler' },
  timeout:   { color: '#5F5E5A', bg: '#F1EFE8', label: 'Timeout' },
  other:     { color: '#5F5E5A', bg: '#F1EFE8', label: 'Sonstig' },
}

function StatusBadge({ category, status }) {
  const cfg = STATUS_CONFIG[category] || STATUS_CONFIG.other
  const text = status > 0 ? `${status} – ${cfg.label}` : cfg.label
  return <span style={{ background: cfg.bg, color: cfg.color, fontSize: 11, padding: '2px 10px', borderRadius: 99, fontWeight: 500, whiteSpace: 'nowrap' }}>{text}</span>
}

function CrawlTab() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true); setResult(null); setError(null); setFilter('all')
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unbekannter Fehler')
      setResult(data)
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const filtered = result?.urls?.filter(u => filter === 'all' || u.category === filter) || []
  const hasProblems = result && (result.summary.notFound + result.summary.errors + result.summary.timeouts) > 0

  return (
    <div>
      <form className={styles.searchBar} onSubmit={handleSubmit}>
        <input type="text" className={styles.urlInput} placeholder="https://deine-website.ch"
          value={url} onChange={e => setUrl(e.target.value)} />
        <button type="submit" className={styles.btnPrimary} disabled={loading}>
          {loading ? 'Crawle…' : 'URLs prüfen'}
        </button>
      </form>
      {loading && <LoadingBar text="Website wird gecrawlt – das kann bis zu 30 Sekunden dauern…" />}
      {error && <ErrorBox message={error} />}

      {result && (
        <div className={styles.resultsWrap}>
          {result.summary.truncated && (
            <div className={styles.infoBox}>
              Hinweis: {result.summary.totalFound} URLs gefunden – es wurden die ersten 100 geprüft.
            </div>
          )}

          {/* Zusammenfassung */}
          <div className={styles.metricsGrid} style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            {[
              { label: 'Geprüfte URLs', value: result.summary.total, color: '#1a1a1a' },
              { label: '✓ Erreichbar', value: result.summary.ok, color: '#1D9E75' },
              { label: '↪ Weiterleitungen', value: result.summary.redirects, color: '#185FA5' },
              { label: '✕ Nicht gefunden (404)', value: result.summary.notFound, color: result.summary.notFound > 0 ? '#E24B4A' : '#1a1a1a' },
              { label: '✕ Server-Fehler', value: result.summary.errors, color: result.summary.errors > 0 ? '#E24B4A' : '#1a1a1a' },
              { label: '⏱ Timeouts', value: result.summary.timeouts, color: result.summary.timeouts > 0 ? '#EF9F27' : '#1a1a1a' },
            ].map((m, i) => (
              <div key={i} className={styles.metricCard}>
                <span className={styles.mLabel}>{m.label}</span>
                <span className={styles.mValue} style={{ color: m.color, fontSize: '1.5rem' }}>{m.value}</span>
              </div>
            ))}
          </div>

          {/* Gesamtbewertung */}
          <div className={styles.crawlSummaryBar} style={{ borderColor: hasProblems ? '#E24B4A' : '#1D9E75', background: hasProblems ? '#FCEBEB' : '#E1F5EE' }}>
            <span style={{ fontSize: 20 }}>{hasProblems ? '⚠' : '✓'}</span>
            <p style={{ color: hasProblems ? '#A32D2D' : '#0F6E56', fontSize: 14, fontWeight: 500 }}>
              {hasProblems
                ? `${result.summary.notFound + result.summary.errors} fehlerhafte URL${result.summary.notFound + result.summary.errors > 1 ? 's' : ''} gefunden – sofortige Behebung empfohlen.`
                : `Alle ${result.summary.ok} geprüften URLs sind erreichbar. Keine Fehler gefunden.`
              }
            </p>
          </div>

          {/* Filter-Buttons */}
          <div className={styles.filterBar}>
            {[
              { key: 'all', label: `Alle (${result.summary.total})` },
              { key: 'not_found', label: `404 (${result.summary.notFound})` },
              { key: 'error', label: `Fehler (${result.summary.errors})` },
              { key: 'redirect', label: `Weiterleitungen (${result.summary.redirects})` },
              { key: 'timeout', label: `Timeouts (${result.summary.timeouts})` },
              { key: 'ok', label: `OK (${result.summary.ok})` },
            ].map(f => (
              <button key={f.key}
                className={`${styles.filterBtn} ${filter === f.key ? styles.filterBtnActive : ''}`}
                onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          {/* URL-Tabelle */}
          <SectionCard title={`URLs (${filtered.length})`}>
            {filtered.length === 0 ? (
              <p style={{ fontSize: 13, color: '#888', padding: '1rem 0' }}>Keine URLs in dieser Kategorie.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr><th style={{ width: '50%' }}>URL</th><th>Status</th><th>Zeit</th><th>Weiterleitung zu</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((u, i) => (
                      <tr key={i}>
                        <td className={styles.urlCell}>
                          <a href={u.url} target="_blank" rel="noopener">{u.url.replace(result.domain, '')  || '/'}</a>
                        </td>
                        <td><StatusBadge category={u.category} status={u.status} /></td>
                        <td style={{ fontSize: 12, color: u.ms > 3000 ? '#E24B4A' : u.ms > 1500 ? '#EF9F27' : '#888', whiteSpace: 'nowrap' }}>
                          {u.ms > 0 ? `${u.ms}ms` : '–'}
                        </td>
                        <td style={{ fontSize: 12, color: '#666' }} className={styles.kwCell}>
                          {u.redirectTo ? <a href={u.redirectTo} target="_blank" rel="noopener">{u.redirectTo}</a> : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  )
}

// ── Haupt-App ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [activeTab, setActiveTab] = useState('analyse')
  const [user, setUser] = useState(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
  }

  const tabs = [
    { id: 'analyse',  label: 'SEO Analyse' },
    { id: 'keywords', label: 'Keyword-Recherche' },
    { id: 'backlinks',label: 'Backlink-Analyse' },
    { id: 'crawl',    label: 'URL-Prüfung' },
  ]

  return (
    <main className={styles.main}>
      {/* Nav */}
      <nav className={styles.nav}>
        <span className={styles.navLogo}>SEO<span>Pulse</span></span>
        <div className={styles.navRight}>
          {user ? (
            <>
              <span className={styles.navEmail}>{user.email}</span>
              <a href="/dashboard" className={styles.navBtn}>Dashboard</a>
              <button className={styles.navBtnOutline} onClick={handleLogout}>Abmelden</button>
            </>
          ) : (
            <>
              <a href="/auth" className={styles.navBtn}>Anmelden</a>
              <a href="/auth" className={styles.navBtnPrimary}>Kostenlos starten</a>
            </>
          )}
        </div>
      </nav>

      <div className={styles.hero}>
        <h1 className={styles.logo}>SEO<span>Pulse</span></h1>
        <p className={styles.tagline}>Professionelle SEO-Tools für deine Website</p>
        {!user && (
          <p className={styles.heroSub}>
            <a href="/auth">Kostenlos registrieren</a> um Analysen zu speichern · Gratis: 3 Analysen/Tag
          </p>
        )}
      </div>

      <div className={styles.container}>
        <div className={styles.tabs}>
          {tabs.map(tab => (
            <button key={tab.id}
              className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.tabContent}>
          {activeTab === 'analyse'   && <AnalyseTab user={user} />}
          {activeTab === 'keywords'  && <KeywordsTab />}
          {activeTab === 'backlinks' && <BacklinksTab />}
          {activeTab === 'crawl'     && <CrawlTab />}
        </div>
      </div>
    </main>
  )
}
