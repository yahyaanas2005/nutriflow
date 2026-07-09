const stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { plan, email } = req.body;
  if (!plan || !['pro', 'premium'].includes(plan)) {
    return res.status(400).json({ success: false, error: 'Invalid plan selected' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeKey) {
    // Development/Mock Mode: redirect to local mock checkout
    const priceUSD = plan === 'pro' ? 1.80 : 5.40;
    const pricePKR = plan === 'pro' ? 500 : 1500;
    
    return res.status(200).json({
      success: true,
      url: `/stripe-mock-checkout.html?plan=${plan}&price_usd=${priceUSD}&price_pkr=${pricePKR}&email=${encodeURIComponent(email || '')}`
    });
  }

  // Live Mode: Use Stripe Checkout API with price_data
  try {
    const stripeInstance = stripe(stripeKey);
    const priceInCents = plan === 'pro' ? 180 : 540; // $1.80 or $5.40 in cents
    const planName = plan === 'pro' ? 'NutriFlow Pro' : 'NutriFlow Premium';

    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const successUrl = `${protocol}://${host}/index.html?payment_success=true&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${protocol}://${host}/index.html?payment_cancel=true`;

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: planName,
              description: `Monthly subscription for ${planName}`,
            },
            unit_amount: priceInCents,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email || undefined,
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (error) {
    console.error('[Stripe] Session creation failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
