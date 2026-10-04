const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { requireSubscription } = require("../middleware/subscriptionMiddleware");
const {
  createResource,
  getResources,
  getAllResourcesAdmin,
  deleteResource,
} = require("../controllers/resourceController");

// Multer memory storage config (stores in RAM, not local files)
const storage = multer.memoryStorage();

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

// @route   GET /api/resources          — Protected (Requires Active Subscription)
router.get("/", protect, requireSubscription, getResources);

// @route   GET /api/resources/admin    — Admin all
router.get("/admin", protect, authorizeRoles("admin"), getAllResourcesAdmin);

// @route   POST /api/resources         — Admin upload
router.post("/", protect, authorizeRoles("admin"), uploadFields, createResource);

// @route   DELETE /api/resources/:id   — Admin delete
router.delete("/:id", protect, authorizeRoles("admin"), deleteResource);

module.exports = router;
