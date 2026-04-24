import './globals.css'

export const metadata = {
  title: 'SEOPulse – Professionelle SEO-Analyse',
  description: 'Analysiere jede Website kostenlos auf SEO-Fehler und Verbesserungspotenzial.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
