const Setting = require("../models/Setting");
const User = require("../models/User");
const { getStripe, getOrCreateStripePrice, getOrCreateCustomer } = require("../services/stripeService");

// @desc    Get subscription pricing (Admin & Public/User)
// @route   GET /api/subscription/pricing
// @access  Public / Private
const getPricing = async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "subscription_pricing" });
    if (!setting) {
      setting = await Setting.create({
        key: "subscription_pricing",
        monthlyPrice: 8,
        yearlyPrice: 12,
        currency: "usd",
      });
    }

    res.status(200).json({
      success: true,
      pricing: {
        monthlyPrice: setting.monthlyPrice,
        yearlyPrice: setting.yearlyPrice,
        currency: setting.currency || "usd",
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch subscription pricing", error: error.message });
  }
};

// @desc    Update subscription pricing (Admin only)
// @route   PUT /api/subscription/admin/pricing
// @access  Private/Admin
const updatePricing = async (req, res) => {
  try {
    const { monthlyPrice, yearlyPrice } = req.body;

    if (monthlyPrice === undefined || yearlyPrice === undefined) {
      return res.status(400).json({ message: "Both monthlyPrice and yearlyPrice are required." });
    }

    const mPrice = Number(monthlyPrice);
    const yPrice = Number(yearlyPrice);

    if (isNaN(mPrice) || mPrice < 0 || isNaN(yPrice) || yPrice < 0) {
      return res.status(400).json({ message: "Prices must be non-negative numbers." });
    }

    let setting = await Setting.findOne({ key: "subscription_pricing" });
    if (!setting) {
      setting = new Setting({ key: "subscription_pricing" });
    }

    setting.monthlyPrice = mPrice;
    setting.yearlyPrice = yPrice;
    await setting.save();

    res.status(200).json({
      success: true,
      message: "Subscription pricing updated successfully",
      pricing: {
        monthlyPrice: setting.monthlyPrice,
        yearlyPrice: setting.yearlyPrice,
        currency: setting.currency || "usd",
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to update subscription pricing", error: error.message });
  }
};

// @desc    Get current user's subscription status
// @route   GET /api/subscription/status
// @access  Private
const getStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasAccess = user.hasResourceAccess();

    res.status(200).json({
      success: true,
      subscription: {
        hasAccess,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionStatus: user.subscriptionStatus,
        currentPeriodStart: user.currentPeriodStart,
        currentPeriodEnd: user.currentPeriodEnd,
        cancelAtPeriodEnd: user.cancelAtPeriodEnd,
        stripeCustomerId: user.stripeCustomerId,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch subscription status", error: error.message });
  }
};

// @desc    Create Stripe Checkout Session for subscription
// @route   POST /api/subscription/create-checkout-session
// @access  Private
const createCheckoutSession = async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !["monthly", "yearly"].includes(plan)) {
      return res.status(400).json({ message: "Invalid subscription plan. Choose 'monthly' or 'yearly'." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(user);
    const price = await getOrCreateStripePrice(plan);

    // Origin header or default frontend URL
    const clientUrl = req.headers.origin || "http://localhost:5173";
    const successUrl = `${clientUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}&success=true`;
    const cancelUrl = `${clientUrl}/dashboard?canceled=true`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: user._id.toString(),
        plan: plan,
      },
      subscription_data: {
        metadata: {
          userId: user._id.toString(),
          plan: plan,
        },
      },
    });

    res.status(200).json({ success: true, url: session.url });
  } catch (error) {
    console.error("Create Checkout Session Error:", error);
    res.status(500).json({ message: "Failed to create Stripe Checkout session", error: error.message });
  }
};

// @desc    Verify and sync checkout session after returning from Stripe
// @route   GET /api/subscription/verify-session
// @access  Private
const verifySession = async (req, res) => {
  try {
    const { session_id } = req.query;
    let user = await User.findById(req.user._id);

    if (session_id) {
      try {
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session && session.payment_status === "paid") {
          const userId = session.metadata?.userId || req.user._id.toString();
          const plan = session.metadata?.plan || "monthly";
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            await syncUserSubscription(userId, customerId, subscription, plan);
          } else {
            const isMonthly = plan === "monthly";
            const now = new Date();
            const periodEnd = new Date();
            if (isMonthly) {
              periodEnd.setMonth(periodEnd.getMonth() + 1);
            } else {
              periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            }
            user.subscriptionPlan = plan;
            user.subscriptionStatus = "active";
            user.currentPeriodStart = now;
            user.currentPeriodEnd = periodEnd;
            if (customerId) user.stripeCustomerId = customerId;
            await user.save();
          }
        }
      } catch (stripeErr) {
        console.warn("Could not retrieve Stripe session during verifySession:", stripeErr.message);
      }
    }

    user = await User.findById(req.user._id);
    res.status(200).json({
      success: true,
      subscription: {
        hasAccess: user.hasResourceAccess(),
        subscriptionPlan: user.subscriptionPlan,
        subscriptionStatus: user.subscriptionStatus,
        currentPeriodStart: user.currentPeriodStart,
        currentPeriodEnd: user.currentPeriodEnd,
        cancelAtPeriodEnd: user.cancelAtPeriodEnd,
        stripeCustomerId: user.stripeCustomerId,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Verify Session Error:", error);
    res.status(500).json({ message: "Failed to verify session", error: error.message });
  }
};

// @desc    Create Stripe Billing Customer Portal Session
// @route   POST /api/subscription/create-portal-session
// @access  Private
const createPortalSession = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ message: "No Stripe customer found for this account." });
    }

    const stripe = getStripe();
    const clientUrl = req.headers.origin || "http://localhost:5173";
    const returnUrl = `${clientUrl}/dashboard`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    res.status(200).json({ success: true, url: portalSession.url });
  } catch (error) {
    console.error("Create Portal Session Error:", error);
    res.status(500).json({ message: "Failed to create Stripe portal session", error: error.message });
  }
};

// @desc    Cancel subscription renewal (set cancel_at_period_end)
// @route   POST /api/subscription/cancel
// @access  Private
const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ message: "No active subscription found to cancel." });
    }

    const stripe = getStripe();
    const updatedSub = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    user.cancelAtPeriodEnd = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Subscription renewal cancelled. You retain access until the end of your billing cycle.",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: user.currentPeriodEnd,
    });
  } catch (error) {
    console.error("Cancel Subscription Error:", error);
    res.status(500).json({ message: "Failed to cancel subscription renewal", error: error.message });
  }
};

// @desc    Stripe Webhook Handler
// @route   POST /api/subscription/webhook
// @access  Public (Stripe Signature Verified)
const handleWebhook = async (req, res) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).send("Stripe secret key missing");
  }

  const stripe = getStripe();
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  if (webhookSecret && signature) {
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Fallback parsing for development/testing if webhook secret is not set yet
    try {
      event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).send("Webhook Error: Could not parse body");
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const userId = session.metadata?.userId;
          const plan = session.metadata?.plan || "monthly";
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncUserSubscription(userId, customerId, subscription, plan);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const userId = subscription.metadata?.userId;
        const plan = subscription.metadata?.plan;
        await syncUserSubscription(userId, customerId, subscription, plan);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        let user = null;

        if (subscription.metadata?.userId) {
          user = await User.findById(subscription.metadata.userId);
        }
        if (!user && customerId) {
          user = await User.findOne({ stripeCustomerId: customerId });
        }

        if (user) {
          user.subscriptionStatus = "canceled";
          user.cancelAtPeriodEnd = false;
          await user.save();
          console.log(`✅ Subscription canceled for user ${user.email}`);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const customerId = subscription.customer;
          await syncUserSubscription(subscription.metadata?.userId, customerId, subscription);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const customerId = subscription.customer;

          let user = await User.findOne({ stripeCustomerId: customerId });
          if (user) {
            user.subscriptionStatus = subscription.status || "past_due";
            await user.save();
            console.log(`⚠️ Payment failed for user ${user.email}, status updated to ${user.subscriptionStatus}`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook Handler Processing Error:", err);
    res.status(500).send(`Webhook Processing Error: ${err.message}`);
  }
};

/**
 * Helper to update user database fields based on Stripe subscription object
 */
async function syncUserSubscription(userId, customerId, subscription, fallbackPlan) {
  let user = null;
  if (userId) {
    user = await User.findById(userId);
  }
  if (!user && customerId) {
    user = await User.findOne({ stripeCustomerId: customerId });
  }
  if (!user) return;

  const plan = fallbackPlan || subscription.metadata?.plan || (subscription.items?.data?.[0]?.plan?.interval === "year" ? "yearly" : "monthly");
  const item = subscription.items?.data?.[0];

  const periodStartRaw =
    subscription.current_period_start ||
    item?.current_period_start ||
    subscription.start_date ||
    Math.floor(Date.now() / 1000);

  const periodEndRaw =
    subscription.current_period_end ||
    item?.current_period_end ||
    (Math.floor(Date.now() / 1000) + (plan === "yearly" ? 365 : 30) * 86400);

  user.stripeCustomerId = customerId || user.stripeCustomerId;
  user.stripeSubscriptionId = subscription.id;
  user.subscriptionPlan = plan;
  user.subscriptionStatus = subscription.status || "active";
  user.currentPeriodStart = new Date(periodStartRaw * 1000);
  user.currentPeriodEnd = new Date(periodEndRaw * 1000);
  user.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);

  await user.save();
  console.log(`✅ User subscription synced: ${user.email} -> ${user.subscriptionPlan} (${user.subscriptionStatus}) valid until ${user.currentPeriodEnd}`);
}

module.exports = {
  getPricing,
  updatePricing,
  getStatus,
  createCheckoutSession,
  verifySession,
  createPortalSession,
  cancelSubscription,
  handleWebhook,
};
