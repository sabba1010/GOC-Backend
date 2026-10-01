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
// @desc    Upload an image/file (returns Base64 Data URL)
// @access  Private
router.post("/", protect, upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const imageUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    res.status(200).json({
      success: true,
      imageUrl,
      filename: req.file.originalname,
      fileType: req.file.mimetype,
    });
  } catch (error) {
    res.status(500).json({ message: "File upload failed", error: error.message });
  }
});

module.exports = router;
