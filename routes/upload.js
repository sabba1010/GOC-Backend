const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");

// Multer memory storage config (stores in memory, up to 50MB)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Optional Auth Middleware (allows both authenticated & public uploads)
const optionalAuth = (req, res, next) => {
  if (req.headers.authorization) {
    return protect(req, res, next);
  }
  next();
};

// @route   POST /api/upload
// @desc    Upload any image or document file (returns Base64 Data URL)
// @access  Public / Private
router.post("/", optionalAuth, (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error("Multer file upload error:", err);
      return res.status(400).json({ success: false, message: `Upload failed: ${err.message}` });
    }

    try {
      const file = (req.files && req.files.length > 0) ? req.files[0] : req.file;
      if (!file) {
        return res.status(400).json({ success: false, message: "No file received in upload request" });
      }

      const mimeType = file.mimetype || "application/octet-stream";
      const base64Data = file.buffer.toString("base64");
      const fileUrl = `data:${mimeType};base64,${base64Data}`;

      return res.status(200).json({
        success: true,
        imageUrl: fileUrl,
        url: fileUrl,
        filename: file.originalname || "attachment",
        fileType: mimeType,
        size: file.size,
      });
    } catch (error) {
      console.error("File processing error:", error);
      return res.status(500).json({ success: false, message: "File processing failed", error: error.message });
    }
  });
});

module.exports = router;
