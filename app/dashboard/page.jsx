'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import styles from './dashboard.module.css'

export default function Dashboard() {
  const [user, setUser] = useState(null)
  const [analyses, setAnalyses] = useState([])
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    setUser(user)

    // Analysen laden
    const { data: analysesData } = await supabase
      .from('analyses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    setAnalyses(analysesData || [])

    // Nutzungslimit laden
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    setUsage(profileData)
    setLoading(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  async function deleteAnalysis(id) {
    await supabase.from('analyses').delete().eq('id', id)
    setAnalyses(prev => prev.filter(a => a.id !== id))
  }

  function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('de-CH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  function ScoreCircle({ score }) {
    const color = score >= 70 ? '#1D9E75' : score >= 40 ? '#EF9F27' : '#E24B4A'
    return (
      <div className={styles.scoreCircle} style={{ borderColor: color, color }}>
        {score}
      </div>
    )
  }

  const isPro = usage?.plan === 'pro'
  const usedToday = usage?.analyses_today || 0
  const limit = isPro ? '∞' : '3'
  const usagePercent = isPro ? 0 : Math.min((usedToday / 3) * 100, 100)

  if (loading) {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.spinner} />
        <p>Dashboard wird geladen…</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <a href="/" className={styles.logo}>SEO<span>Pulse</span></a>
        <div className={styles.headerRight}>
          <span className={styles.userEmail}>{user?.email}</span>
          {isPro && <span className={styles.proBadge}>Pro</span>}
          <button className={styles.logoutBtn} onClick={handleLogout}>Abmelden</button>
        </div>
      </header>

      <div className={styles.container}>
        <h1 className={styles.pageTitle}>Dashboard</h1>

        {/* Stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Analysen heute</p>
            <p className={styles.statValue}>{usedToday} <span>/ {limit}</span></p>
            {!isPro && (
              <div className={styles.usageBar}>
                <div className={styles.usageFill} style={{ width: `${usagePercent}%`, background: usagePercent >= 100 ? '#E24B4A' : '#1D9E75' }} />
              </div>
            )}
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Gespeicherte Analysen</p>
            <p className={styles.statValue}>{analyses.length}</p>
          </div>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>Aktueller Plan</p>
            <p className={styles.statValue} style={{ fontSize: '1.2rem' }}>
              {isPro ? 'Pro' : 'Gratis'}
            </p>
            {!isPro && (
              <a href="/" className={styles.upgradeLink}>Auf Pro upgraden →</a>
            )}
          </div>
        </div>

        {/* Gespeicherte Analysen */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Gespeicherte Analysen</h2>
            <a href="/" className={styles.newBtn}>+ Neue Analyse</a>
          </div>

          {analyses.length === 0 ? (
            <div className={styles.emptyState}>
              <p>Noch keine Analysen gespeichert.</p>
              <a href="/" className={styles.ctaBtn}>Jetzt erste Analyse starten</a>
            </div>
          ) : (
            <div className={styles.analysesList}>
              {analyses.map(analysis => (
                <div key={analysis.id} className={styles.analysisCard}>
                  <div className={styles.analysisLeft}>
                    <ScoreCircle score={analysis.score} />
                    <div>
                      <p className={styles.analysisUrl}>{analysis.url}</p>
                      <p className={styles.analysisDate}>{formatDate(analysis.created_at)}</p>
                      <div className={styles.analysisMeta}>
                        {analysis.issues_critical > 0 && (
                          <span className={styles.metaErr}>{analysis.issues_critical} kritisch</span>
                        )}
                        {analysis.issues_warnings > 0 && (
                          <span className={styles.metaWarn}>{analysis.issues_warnings} Warnungen</span>
                        )}
                        {analysis.issues_critical === 0 && analysis.issues_warnings === 0 && (
                          <span className={styles.metaOk}>Keine Fehler</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={styles.analysisActions}>
                    <button className={styles.deleteBtn} onClick={() => deleteAnalysis(analysis.id)} title="Löschen">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pro Teaser für Gratis-User */}
        {!isPro && (
          <div className={styles.proTeaser}>
            <div>
              <h3>SEOPulse Pro</h3>
              <p>Unlimitierte Analysen, Keyword-Recherche, Backlink-Analyse und mehr.</p>
            </div>
            <button className={styles.proBtn}>Pro – CHF 19/Monat</button>
          </div>
        )}
      </div>
    </div>
  )
}
