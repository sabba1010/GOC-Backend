const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const {
  getMessages,
  getConversations,
  startDirectConversation,
  getCircles,
  toggleJoinCircle,
  sendMessage,
  deleteOwnMessage,
  toggleReaction,
  reportMessage,
  toggleBlockUser,
  getBlockedUsers,
  getUnreadCount,
  updateReadState,
  updateMuteNotifications,
  searchUsersForMention,
} = require("../controllers/chatController");

// All student chat endpoints require valid user authentication
router.use(protect);

router.get("/conversations", getConversations);
router.post("/conversations/direct", startDirectConversation);
router.get("/circles", getCircles);
router.post("/circles/:id/join", toggleJoinCircle);

router.get("/rooms/global/messages", getMessages);
router.get("/rooms/:roomId/messages", getMessages);
router.post("/messages", sendMessage);
router.delete("/messages/:id", deleteOwnMessage);

router.post("/messages/:id/reactions", toggleReaction);
router.post("/messages/:id/report", reportMessage);

router.post("/members/:id/block", toggleBlockUser);
router.get("/members/blocked", getBlockedUsers);

router.get("/unread-count", getUnreadCount);
router.patch("/read-state", updateReadState);
router.patch("/mute-notifications", updateMuteNotifications);

router.get("/users/search", searchUsersForMention);

module.exports = router;
