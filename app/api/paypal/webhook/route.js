import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// PayPal Redirect nach erfolgreicher Zahlung
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const success        = searchParams.get('success')
  const userId         = searchParams.get('user_id')
  const subscriptionId = searchParams.get('subscription_id')

  if (success === 'true' && userId) {
    const supabase = getSupabaseAdmin()
    await supabase.from('profiles').upsert({
      id: userId,
      plan: 'pro',
      paypal_subscription_id: subscriptionId || null,
      plan_started_at: new Date().toISOString(),
    })
    return NextResponse.redirect(`${origin}/dashboard?upgrade=success`)
  }

  return NextResponse.redirect(`${origin}/pricing?error=payment_failed`)
}

// PayPal Webhook Events
export async function POST(request) {
  try {
    const event = await request.json()
    const supabase = getSupabaseAdmin()

    if (event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
        event.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      const userId = event.resource?.custom_id
      if (userId) {
        await supabase.from('profiles').update({
          plan: 'free',
          paypal_subscription_id: null,
        }).eq('id', userId)
      }
    }

    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json({ error: 'Webhook Fehler' }, { status: 400 })
  }
}
