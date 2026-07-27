const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  logoutUser,
  getAllUsers,
  updateUserStatus,
  toggleSaveOpportunity,
  toggleApplyOpportunity,
} = require("../controllers/userController");

const { protect, authorizeRoles } = require("../middleware/authMiddleware");

// ── Public ──────────────────────────────────────
router.post("/register", registerUser);       // POST /api/users/register
router.post("/login",    loginUser);          // POST /api/users/login

// ── Protected (requires JWT) ────────────────────
router.get("/me",        protect, getMe);     // GET  /api/users/me
router.put("/me",        protect, updateMe);  // PUT  /api/users/me
router.post("/logout",   protect, logoutUser);// POST /api/users/logout
router.post("/save-opportunity/:id", protect, toggleSaveOpportunity);
router.post("/apply-opportunity/:id", protect, toggleApplyOpportunity);

// ── Admin ───────────────────────────────────────
router.get("/",          protect, authorizeRoles("admin"), getAllUsers);
router.put("/:id/status", protect, authorizeRoles("admin"), updateUserStatus);

module.exports = router;
