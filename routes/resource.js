const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const {
  createResource,
  getResources,
  getAllResourcesAdmin,
  deleteResource,
} = require("../controllers/resourceController");

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|pdf/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext.slice(1))) {
    cb(null, true);
  } else {
    cb(new Error("Only images (jpg, png, gif, webp) and PDF files are allowed"), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter,
});

// Fields: image (optional) + pdf (optional)
const uploadFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "pdf", maxCount: 1 },
]);

// @route   GET /api/resources          — Public (published)
router.get("/", protect, getResources);

// @route   GET /api/resources/admin    — Admin all
router.get("/admin", protect, authorizeRoles("admin"), getAllResourcesAdmin);

// @route   POST /api/resources         — Admin upload
router.post("/", protect, authorizeRoles("admin"), uploadFields, createResource);

// @route   DELETE /api/resources/:id   — Admin delete
router.delete("/:id", protect, authorizeRoles("admin"), deleteResource);

module.exports = router;
