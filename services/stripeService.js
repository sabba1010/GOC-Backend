const Stripe = require("stripe");
const Setting = require("../models/Setting");
const User = require("../models/User");

// Initialize Stripe SDK safely
const getStripe = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured in server environment variables.");
  }
  return new Stripe(secretKey);
};

/**
 * Gets or creates a Stripe Price for a given plan ('monthly' | 'yearly')
 * based on the central Admin pricing settings.
 */
const getOrCreateStripePrice = async (plan) => {
  const stripe = getStripe();

  // Fetch central pricing settings from MongoDB (or create default)
  let setting = await Setting.findOne({ key: "subscription_pricing" });
  if (!setting) {
    setting = await Setting.create({
      key: "subscription_pricing",
      monthlyPrice: 8,
      yearlyPrice: 12,
      currency: "usd",
    });
  }

  const isMonthly = plan === "monthly";
  const amountInCents = Math.round((isMonthly ? setting.monthlyPrice : setting.yearlyPrice) * 100);
  const interval = isMonthly ? "month" : "year";
  const productName = `GOC Resources Subscription (${isMonthly ? "Monthly" : "Yearly"})`;

  // Search existing active products in Stripe or create one
  const products = await stripe.products.list({ limit: 50, active: true });
  let product = products.data.find((p) => p.name === productName || p.metadata?.goc_plan === plan);

  if (!product) {
    product = await stripe.products.create({
      name: productName,
      description: `Subscription access to the Girls on Campus Resources Dashboard (${isMonthly ? "Monthly" : "Yearly"}).`,
      metadata: { goc_plan: plan },
    });
  }

  // Look for existing price for this product matching exact amount and interval
  const prices = await stripe.prices.list({ product: product.id, active: true });
  let price = prices.data.find(
    (p) => p.unit_amount === amountInCents && p.recurring && p.recurring.interval === interval
  );

  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: amountInCents,
      currency: "usd",
      recurring: { interval },
      metadata: { goc_plan: plan },
    });
  }

  return price;
};

/**
 * Ensures a Stripe Customer exists for the user and returns customer ID
 */
const getOrCreateCustomer = async (user) => {
  const stripe = getStripe();

  if (user.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(user.stripeCustomerId);
      if (customer && !customer.deleted) {
        return customer.id;
      }
    } catch (err) {
      console.warn("Could not retrieve existing Stripe customer, creating new one:", err.message);
    }
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      userId: user._id.toString(),
      username: user.username,
    },
  });

  user.stripeCustomerId = customer.id;
  await user.save();

  return customer.id;
};

module.exports = {
  getStripe,
  getOrCreateStripePrice,
  getOrCreateCustomer,
};
