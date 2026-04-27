import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient as createServerClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Supabase Admin Client (service_role) für Webhooks
function getSupabaseAdmin() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function POST(request) {
  const body = await request.text()
  const sig  = request.headers.get('stripe-signature')

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId  = session.metadata?.user_id
      if (!userId) break

      await supabase.from('profiles').upsert({
        id: userId,
        plan: 'pro',
        stripe_customer_id:     session.customer,
        stripe_subscription_id: session.subscription,
        plan_started_at: new Date().toISOString(),
      })
      break
    }

    case 'customer.subscription.deleted':
    case 'customer.subscription.paused': {
      const sub        = event.data.object
      const customerId = sub.customer

      // User anhand Stripe Customer ID finden und auf free setzen
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (profile) {
        await supabase.from('profiles').update({
          plan: 'free',
          stripe_subscription_id: null,
        }).eq('id', profile.id)
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoice    = event.data.object
      const customerId = invoice.customer

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      if (profile) {
        await supabase.from('profiles').update({
          plan: 'free',
        }).eq('id', profile.id)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
