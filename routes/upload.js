const express = require("express");
const router = express.Router();
const multer = require("multer");

// Multer memory storage config (stores in memory, not disk)
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const { protect, authorizeRoles } = require("../middleware/authMiddleware");

// @route   POST /api/upload
// @desc    Upload an image (returns Base64 Data URL to save directly in DB)
// @access  Private/Admin
router.post("/", protect, authorizeRoles("admin"), upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    // Return Base64 Data URL directly
    const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    res.status(200).json({ success: true, imageUrl });
  } catch (error) {
    res.status(500).json({ message: "File upload failed", error: error.message });
  }
});

module.exports = router;
