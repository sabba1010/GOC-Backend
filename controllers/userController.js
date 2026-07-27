const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ── Generate JWT ───────────────────────────────
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// ──────────────────────────────────────────────
// @route   POST /api/users/register
// @desc    Register new user
// @access  Public
// ──────────────────────────────────────────────
const registerUser = async (req, res) => {
  try {
    const { name, username, email, password, role } = req.body;

    if (!name || !username || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "Email already registered" });
    }
    if (await User.findOne({ username })) {
      return res.status(400).json({ message: "Username already taken" });
    }

    const user = await User.create({ name, username, email, password, role: role || "student" });

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token: generateToken(user._id, user.role),
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   POST /api/users/login
// @desc    Login & return JWT
// @access  Public
// ──────────────────────────────────────────────
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.status === "Suspended") {
      return res.status(403).json({ message: "Your account has been suspended by the Admin. Please contact support." });
    }

    res.status(200).json({
      success: true,
      message: "Login successful",
      token: generateToken(user._id, user.role),
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   GET /api/users/me
// @desc    Get logged-in user profile
// @access  Private
// ──────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   PUT /api/users/me
// @desc    Update logged-in user profile
// @access  Private
// ──────────────────────────────────────────────
const updateMe = async (req, res) => {
  try {
    const { name, bio, avatar } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, bio, avatar },
      { new: true, runValidators: true }
    ).select("-password");
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   POST /api/users/logout
// @desc    Logout user
// @access  Private
// ──────────────────────────────────────────────
const logoutUser = async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Logged out. Please delete token from client.",
  });
};

// ──────────────────────────────────────────────
// @route   GET /api/users
// @desc    Get all users (Admin only)
// @access  Private/Admin
// ──────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: "admin" } }).select("-password");
    res.status(200).json({ success: true, count: users.length, users });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   PUT /api/users/:id/status
// @desc    Update user status (Active/Suspended)
// @access  Private/Admin
// ──────────────────────────────────────────────
const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["Active", "Suspended"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Prevent changing admin status if it's the main admin
    if (user.role === "admin" && user.email === "admin@girlsoncampus.org") {
      return res.status(403).json({ message: "Cannot suspend super admin" });
    }

    user.status = status;
    await user.save();

    res.status(200).json({ success: true, message: `User status updated to ${status}`, user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = { registerUser, loginUser, getMe, updateMe, logoutUser, getAllUsers, updateUserStatus };
