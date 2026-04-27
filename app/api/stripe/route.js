import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase-server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export async function POST(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt.' }, { status: 401 })
  }

  const { origin } = await request.json()

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'sepa_debit', 'paypal'],
      mode: 'subscription',
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: 'chf',
          product_data: {
            name: 'SEOPulse Pro',
            description: 'Alle 4 SEO-Tools: Analyse, Keywords, Backlinks, URL-Prüfung – unlimitiert',
          },
          unit_amount: 1900, // CHF 19.00
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      metadata: {
        user_id: user.id,
        user_email: user.email,
      },
      success_url: `${origin}/dashboard?upgrade=success`,
      cancel_url:  `${origin}/pricing?cancelled=true`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
