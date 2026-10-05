const express = require("express");
const router = express.Router();
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const {
  getPricing,
  updatePricing,
  getStatus,
  createCheckoutSession,
  verifySession,
  createPortalSession,
  cancelSubscription,
  handleWebhook,
} = require("../controllers/subscriptionController");

// Public / Authenticated Pricing route
router.get("/pricing", getPricing);

// Admin-only Pricing update route
router.put("/admin/pricing", protect, authorizeRoles("admin"), updatePricing);

// User Subscription routes (Protected)
router.get("/status", protect, getStatus);
router.get("/verify-session", protect, verifySession);
router.post("/create-checkout-session", protect, createCheckoutSession);
router.post("/create-portal-session", protect, createPortalSession);
router.post("/cancel", protect, cancelSubscription);

// Webhook route (can also be invoked directly if mounted)
router.post("/webhook", handleWebhook);

module.exports = router;
