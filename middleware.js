import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

const PRO_API_ROUTES = [
  '/api/keywords',
  '/api/backlinks',
  '/api/crawl',
]

export async function middleware(request) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // /dashboard schützen
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    return NextResponse.redirect(url)
  }

  // Pro-API-Routen schützen
  const isPro_route = PRO_API_ROUTES.some(r => request.nextUrl.pathname.startsWith(r))
  if (isPro_route) {
    if (!user) {
      return NextResponse.json({
        error: 'Anmeldung erforderlich. Bitte registriere dich um diese Funktion zu nutzen.',
        requiresAuth: true,
      }, { status: 401 })
    }

    // Plan prüfen
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single()

    if (!profile || profile.plan !== 'pro') {
      return NextResponse.json({
        error: 'Diese Funktion ist nur für Pro-User verfügbar. Upgrade auf Pro für CHF 19/Monat.',
        requiresUpgrade: true,
      }, { status: 403 })
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/keywords/:path*',
    '/api/backlinks/:path*',
    '/api/crawl/:path*',
  ],
}
