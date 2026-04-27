'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import styles from './pricing.module.css'

const FREE_FEATURES = [
  { text: 'SEO-Analyse (1 Tool)', included: true },
  { text: '3 Analysen pro Tag', included: true },
  { text: 'Keyword-Recherche', included: false },
  { text: 'Backlink-Analyse', included: false },
  { text: 'URL-Prüfung / Deep Crawl', included: false },
  { text: 'Analysen speichern', included: false },
  { text: 'Unlimitierte Nutzung', included: false },
]

const PRO_FEATURES = [
  { text: 'Alle 4 SEO-Tools', included: true },
  { text: 'Unlimitierte Analysen', included: true },
  { text: 'Keyword-Recherche', included: true },
  { text: 'Backlink-Analyse', included: true },
  { text: 'URL-Prüfung / Deep Crawl', included: true },
  { text: 'Analysen speichern & Dashboard', included: true },
  { text: 'Prioritäts-Support', included: true },
]

export default function PricingPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const searchParams = useSearchParams()
  const cancelled = searchParams.get('cancelled')
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
  }, [])

  async function handleStripe() {
    if (!user) { window.location.href = '/auth'; return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  async function handlePayPal() {
    if (!user) { window.location.href = '/auth'; return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/paypal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a href="/" className={styles.logo}>SEO<span>Pulse</span></a>
        <div className={styles.navRight}>
          {user ? (
            <a href="/dashboard" className={styles.navBtn}>Dashboard</a>
          ) : (
            <a href="/auth" className={styles.navBtn}>Anmelden</a>
          )}
        </div>
      </nav>

      <div className={styles.hero}>
        <h1>Einfache, transparente Preise</h1>
        <p>Starte gratis – upgrade wenn du mehr brauchst</p>
      </div>

      {cancelled && (
        <div className={styles.cancelledBox}>
          Zahlung abgebrochen – kein Betrag wurde belastet.
        </div>
      )}

      {error && (
        <div className={styles.errorBox}>{error}</div>
      )}

      <div className={styles.plansGrid}>

        {/* Gratis Plan */}
        <div className={styles.planCard}>
          <div className={styles.planHeader}>
            <h2>Gratis</h2>
            <div className={styles.price}>
              <span className={styles.amount}>CHF 0</span>
              <span className={styles.period}>/ Monat</span>
            </div>
            <p className={styles.planDesc}>Für den Einstieg</p>
          </div>
          <ul className={styles.featureList}>
            {FREE_FEATURES.map((f, i) => (
              <li key={i} className={f.included ? styles.featureOn : styles.featureOff}>
                <span>{f.included ? '✓' : '✕'}</span>
                {f.text}
              </li>
            ))}
          </ul>
          <a href={user ? '/' : '/auth'} className={styles.btnOutline}>
            {user ? 'Weiter mit Gratis' : 'Kostenlos starten'}
          </a>
        </div>

        {/* Pro Plan */}
        <div className={`${styles.planCard} ${styles.planCardPro}`}>
          <div className={styles.proBadge}>Empfohlen</div>
          <div className={styles.planHeader}>
            <h2>Pro</h2>
            <div className={styles.price}>
              <span className={styles.amount}>CHF 19</span>
              <span className={styles.period}>/ Monat</span>
            </div>
            <p className={styles.planDesc}>Alle Tools, unlimitiert</p>
          </div>
          <ul className={styles.featureList}>
            {PRO_FEATURES.map((f, i) => (
              <li key={i} className={styles.featureOn}>
                <span>✓</span>
                {f.text}
              </li>
            ))}
          </ul>

          <div className={styles.checkoutButtons}>
            <button
              className={styles.btnStripe}
              onClick={handleStripe}
              disabled={loading}>
              {loading ? 'Weiterleitung…' : '💳 Mit Kreditkarte / SEPA bezahlen'}
            </button>
            <button
              className={styles.btnPayPal}
              onClick={handlePayPal}
              disabled={loading}>
              <svg width="80" height="20" viewBox="0 0 80 20" fill="none">
                <text x="0" y="15" fontFamily="Arial" fontSize="14" fontWeight="bold">
                  <tspan fill="#003087">Pay</tspan><tspan fill="#009cde">Pal</tspan>
                </text>
              </svg>
              Mit PayPal bezahlen
            </button>
          </div>

          <p className={styles.cancelNote}>Jederzeit kündbar · Keine versteckten Kosten</p>
        </div>
      </div>

      {/* FAQ */}
      <div className={styles.faq}>
        <h3>Häufige Fragen</h3>
        {[
          { q: 'Kann ich jederzeit kündigen?', a: 'Ja – du kannst dein Abo jederzeit im Dashboard kündigen. Es läuft bis zum Ende des bezahlten Monats.' },
          { q: 'Welche Zahlungsmethoden werden akzeptiert?', a: 'Kreditkarte (Visa, Mastercard), SEPA-Lastschrift, und PayPal.' },
          { q: 'Gibt es eine Probezeit?', a: 'Die Gratis-Version ist dauerhaft kostenlos. Du kannst das Tool ausgiebig testen bevor du upgradest.' },
          { q: 'Was passiert mit meinen Daten wenn ich kündige?', a: 'Deine gespeicherten Analysen bleiben erhalten. Du verlierst nur den Zugang zu Keyword-, Backlink-Analyse und URL-Prüfung.' },
        ].map((item, i) => (
          <div key={i} className={styles.faqItem}>
            <p className={styles.faqQ}>{item.q}</p>
            <p className={styles.faqA}>{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
