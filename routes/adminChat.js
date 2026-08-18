const express = require("express");
const router = express.Router();
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const {
  getAdminMessages,
  getReports,
  updateReportStatus,
  getModerationFlags,
  removeMessage,
  restoreMessage,
  warnMember,
  muteMember,
  restrictMember,
  removeAccess,
  restoreAccess,
  pauseRoom,
  resumeRoom,
  setSlowMode,
  pinMessage,
  unpinMessage,
  getAuditLogs,
} = require("../controllers/adminChatController");

// All admin chat routes require JWT protection and Admin role
router.use(protect);
router.use(authorizeRoles("admin"));

router.get("/messages", getAdminMessages);
router.get("/reports", getReports);
router.patch("/reports/:id/status", updateReportStatus);
router.get("/flags", getModerationFlags);

router.post("/messages/:id/remove", removeMessage);
router.post("/messages/:id/restore", restoreMessage);

router.post("/members/:id/warn", warnMember);
router.post("/members/:id/mute", muteMember);
router.post("/members/:id/restrict", restrictMember);
router.post("/members/:id/remove-access", removeAccess);
router.post("/members/:id/restore", restoreAccess);

router.post("/room/pause", pauseRoom);
router.post("/room/resume", resumeRoom);
router.patch("/room/slow-mode", setSlowMode);

router.post("/messages/:id/pin", pinMessage);
router.delete("/pinned/:id", unpinMessage);

router.get("/audit-logs", getAuditLogs);

module.exports = router;
