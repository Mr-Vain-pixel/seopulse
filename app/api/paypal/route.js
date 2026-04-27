import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const PAYPAL_BASE = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function getPayPalToken() {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json()
  return data.access_token
}

export async function POST(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt.' }, { status: 401 })
  }

  const { origin } = await request.json()

  try {
    const token = await getPayPalToken()

    // PayPal Subscription Plan erstellen (oder bestehenden nutzen)
    const planId = process.env.PAYPAL_PLAN_ID

    const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: planId,
        subscriber: { email_address: user.email },
        application_context: {
          brand_name: 'SEOPulse',
          user_action: 'SUBSCRIBE_NOW',
          return_url: `${origin}/api/paypal/webhook?success=true&user_id=${user.id}`,
          cancel_url: `${origin}/pricing?cancelled=true`,
        },
        custom_id: user.id,
      }),
    })

    const subscription = await res.json()

    if (!res.ok) {
      throw new Error(subscription.message || 'PayPal Fehler')
    }

    const approvalUrl = subscription.links?.find(l => l.rel === 'approve')?.href
    return NextResponse.json({ url: approvalUrl, subscriptionId: subscription.id })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
