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
    const user = await User.findById(req.user.id)
      .select("-password")
      .populate("savedOpportunities")
      .populate("appliedOpportunities");
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
    const { name, bio, avatar, school, email, certificates, customFields } = req.body;
    
    // Check if email is being changed and is already in use
    if (email && email !== req.user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== req.user.id) {
        return res.status(400).json({ message: "Email is already taken" });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { name, bio, avatar, school, email, certificates, customFields },
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

// ──────────────────────────────────────────────
// @route   POST /api/users/save-opportunity/:id
// @desc    Toggle saving an opportunity
// @access  Private
// ──────────────────────────────────────────────
const toggleSaveOpportunity = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const oppId = req.params.id;
    const isSaved = user.savedOpportunities.includes(oppId);

    if (isSaved) {
      user.savedOpportunities = user.savedOpportunities.filter(
        (id) => id.toString() !== oppId
      );
    } else {
      user.savedOpportunities.push(oppId);
    }

    await user.save();
    res.status(200).json({ success: true, savedOpportunities: user.savedOpportunities });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   POST /api/users/apply-opportunity/:id
// @desc    Toggle applying to an opportunity
// @access  Private
// ──────────────────────────────────────────────
const toggleApplyOpportunity = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const oppId = req.params.id;
    const isApplied = user.appliedOpportunities.includes(oppId);

    if (isApplied) {
      user.appliedOpportunities = user.appliedOpportunities.filter(
        (id) => id.toString() !== oppId
      );
    } else {
      user.appliedOpportunities.push(oppId);
    }

    await user.save();
    res.status(200).json({ success: true, appliedOpportunities: user.appliedOpportunities });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   GET /api/users/submissions
// @desc    Get all student submissions
// @access  Private/Admin
// ──────────────────────────────────────────────
const getAllSubmissions = async (req, res) => {
  try {
    const users = await User.find({ 
      appliedOpportunities: { $exists: true, $not: { $size: 0 } } 
    }).populate("appliedOpportunities").select("-password");
    
    let submissions = [];
    users.forEach(user => {
      user.appliedOpportunities.forEach(opp => {
        submissions.push({
          id: `${user._id}_${opp._id}`,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            school: user.school,
            certificates: user.certificates,
            customFields: user.customFields,
            avatar: user.avatar,
            bio: user.bio,
            username: user.username
          },
          opportunity: {
            id: opp._id,
            title: opp.title,
            category: opp.category,
            deadline: opp.deadline
          },
          status: "Pending", // Default status for now
          appliedAt: user.updatedAt // Fallback date since we don't store timestamp per apply
        });
      });
    });
    
    res.status(200).json({ success: true, submissions });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  updateMe,
  logoutUser,
  getAllUsers,
  updateUserStatus,
  toggleSaveOpportunity,
  toggleApplyOpportunity,
  getAllSubmissions,
};
