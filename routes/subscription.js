const express = require("express");
const router = express.Router();
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const {
  getPricing,
  updatePricing,
  getAdminStats,
  getStatus,
  createCheckoutSession,
  verifySession,
  createPortalSession,
  cancelSubscription,
  handleWebhook,
} = require("../controllers/subscriptionController");

// Public / Authenticated Pricing route
router.get("/pricing", getPricing);

// Admin-only Pricing & Stats routes
router.put("/admin/pricing", protect, authorizeRoles("admin"), updatePricing);
router.get("/admin/stats", protect, authorizeRoles("admin"), getAdminStats);

// User Subscription routes (Protected)
router.get("/status", protect, getStatus);
router.get("/verify-session", protect, verifySession);
router.post("/create-checkout-session", protect, createCheckoutSession);
router.post("/create-portal-session", protect, createPortalSession);
router.post("/cancel", protect, cancelSubscription);

// Webhook route (can also be invoked directly if mounted)
router.post("/webhook", handleWebhook);

module.exports = router;
