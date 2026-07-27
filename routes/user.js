const express = require("express");
const router = express.Router();

const {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  logoutUser,
} = require("../controllers/userController");

const { protect } = require("../middleware/authMiddleware");

// ── Public ──────────────────────────────────────
router.post("/register", registerUser);       // POST /api/users/register
router.post("/login",    loginUser);          // POST /api/users/login

// ── Protected (requires JWT) ────────────────────
router.get("/me",        protect, getMe);     // GET  /api/users/me
router.put("/me",        protect, updateMe);  // PUT  /api/users/me
router.post("/logout",   protect, logoutUser);// POST /api/users/logout

module.exports = router;
