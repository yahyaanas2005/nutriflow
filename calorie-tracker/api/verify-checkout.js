const stripe = require('stripe');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Session ID is required' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;

  // Mock Session Verification
  if (!stripeKey || sessionId.startsWith('mock_')) {
    const plan = sessionId.includes('premium') ? 'premium' : 'pro';
    return res.status(200).json({
      success: true,
      plan,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  // Real Stripe Session Verification
  try {
    const stripeInstance = stripe(stripeKey);
    const session = await stripeInstance.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const lineItems = await stripeInstance.checkout.sessions.listLineItems(sessionId);
      const unitAmount = lineItems.data[0]?.price?.unit_amount;
      const plan = unitAmount === 540 ? 'premium' : 'pro';
      
      let end = new Date();
      end.setDate(end.getDate() + 30);
      if (session.subscription) {
        const subDetails = await stripeInstance.subscriptions.retrieve(session.subscription);
        end = new Date(subDetails.current_period_end * 1000);
      }

      return res.status(200).json({
        success: true,
        plan,
        status: 'active',
        currentPeriodEnd: end.toISOString()
      });
    } else {
      return res.status(200).json({
        success: false,
        error: `Payment status is ${session.payment_status}`
      });
    }
  } catch (error) {
    console.error('[Stripe] Verification failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
