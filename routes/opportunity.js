const express = require("express");
const router = express.Router();

const {
  createOpportunity,
  getAllOpportunities,
  updateOpportunity,
  deleteOpportunity,
} = require("../controllers/opportunityController");

const { protect, authorizeRoles } = require("../middleware/authMiddleware");

// ── Public ──────────────────────────────────────
router.get("/", getAllOpportunities); // GET /api/opportunities

// ── Admin Only ──────────────────────────────────
router.post("/", protect, authorizeRoles("admin"), createOpportunity);
router.put("/:id", protect, authorizeRoles("admin"), updateOpportunity);
router.delete("/:id", protect, authorizeRoles("admin"), deleteOpportunity);

module.exports = router;
