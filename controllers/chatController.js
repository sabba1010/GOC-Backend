const LiveChatMessage = require("../models/LiveChatMessage");
const ChatRoom = require("../models/ChatRoom");
const ChatReadState = require("../models/ChatReadState");
const UserBlock = require("../models/UserBlock");
const ChatReport = require("../models/ChatReport");
const User = require("../models/User");
const Opportunity = require("../models/Opportunity");
const { validateUserCanPost, evaluateMessageSpam } = require("../services/chatModeration");
const { getIO } = require("../socket/chatSocket");

// @desc    Get paginated chat messages for global room
// @route   GET /api/chat/rooms/global/messages
// @access  Private
const getMessages = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const { cursor } = req.query;

    const globalRoom = await ChatRoom.findOne({ type: "global" });
    if (!globalRoom) {
      return res.status(200).json({ messages: [], nextCursor: null, hasMore: false, room: null });
    }

    // Get list of blocked user IDs for the current user
    const blockedRecords = await UserBlock.find({ blockerId: req.user._id });
    const blockedUserIds = blockedRecords.map((b) => b.blockedUserId.toString());

    // Query filter
    const query = {
      roomId: globalRoom._id,
      senderId: { $nin: blockedUserIds },
    };

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const messages = await LiveChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate("senderId", "name username avatar role status")
      .populate({
        path: "replyToId",
        select: "content displayNameSnapshot senderId isDeleted",
        populate: { path: "senderId", select: "name username" },
      })
      .populate("linkedOpportunityId", "title organization category deadline image status")
      .populate("mentions", "name username");

    let hasMore = false;
    let nextCursor = null;

    if (messages.length > limit) {
      hasMore = true;
      messages.pop(); // Remove 31st item
      nextCursor = messages[messages.length - 1]._id;
    }

    // Reverse to return in ascending chronological order for client display
    const chronologicalMessages = messages.reverse();

    res.json({
      messages: chronologicalMessages,
      nextCursor,
      hasMore,
      room: globalRoom,
    });
  } catch (err) {
    console.error("Error fetching chat messages:", err);
    res.status(500).json({ message: "Server error fetching chat history" });
  }
};

// @desc    Send a new message (REST endpoint)
// @route   POST /api/chat/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { content, replyToId, linkedOpportunityId, mentions } = req.body;

    const globalRoom = await ChatRoom.findOne({ type: "global" });
    if (!globalRoom) {
      return res.status(404).json({ message: "Global room not found" });
    }

    const check = await validateUserCanPost(req.user._id, globalRoom._id);
    if (!check.allowed) {
      return res.status(403).json({ message: check.reason, remainingSeconds: check.remainingSeconds });
    }

    const spamEval = await evaluateMessageSpam(req.user._id, globalRoom._id, content);

    let opportunityRef = null;
    if (linkedOpportunityId) {
      const opp = await Opportunity.findById(linkedOpportunityId);
      if (opp && opp.status === "Published") {
        opportunityRef = opp._id;
      } else {
        return res.status(400).json({ message: "Opportunity not found or not published" });
      }
    }

    let replyRef = null;
    if (replyToId) {
      const targetMsg = await LiveChatMessage.findById(replyToId);
      if (targetMsg) replyRef = targetMsg._id;
    }

    const newMsg = await LiveChatMessage.create({
      roomId: globalRoom._id,
      senderId: req.user._id,
      displayNameSnapshot: req.user.name,
      content: content ? content.trim() : "",
      replyToId: replyRef,
      linkedOpportunityId: opportunityRef,
      mentions: Array.isArray(mentions) ? mentions : [],
      moderationStatus: spamEval.isFlagged ? "flagged" : "clean",
      moderationFlags: spamEval.flags,
    });

    const populatedMsg = await LiveChatMessage.findById(newMsg._id)
      .populate("senderId", "name username avatar role")
      .populate({
        path: "replyToId",
        select: "content displayNameSnapshot senderId",
        populate: { path: "senderId", select: "name" },
      })
      .populate("linkedOpportunityId", "title organization category deadline image status")
      .populate("mentions", "name username");

    // Emit socket event
    const io = getIO();
    if (io) {
      io.to(globalRoom._id.toString()).emit("chat:new", populatedMsg);
    }

    res.status(201).json(populatedMsg);
  } catch (err) {
    console.error("Error creating message:", err);
    res.status(500).json({ message: "Server error sending message" });
  }
};

// @desc    Delete own recent message
// @route   DELETE /api/chat/messages/:id
// @access  Private
const deleteOwnMessage = async (req, res) => {
  try {
    const message = await LiveChatMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Only sender or admin can delete
    if (message.senderId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to delete this message" });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.deleteReason = req.body.reason || "Deleted by user";
    await message.save();

    const io = getIO();
    if (io) {
      io.to(message.roomId.toString()).emit("chat:deleted", { messageId: message._id });
    }

    res.json({ message: "Message deleted", id: message._id });
  } catch (err) {
    console.error("Error deleting message:", err);
    res.status(500).json({ message: "Server error deleting message" });
  }
};

// @desc    Toggle emoji reaction
// @route   POST /api/chat/messages/:id/reactions
// @access  Private
const toggleReaction = async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ message: "Emoji is required" });

    const message = await LiveChatMessage.findById(req.params.id);
    if (!message || message.isDeleted) {
      return res.status(404).json({ message: "Message not found" });
    }

    const existingIdx = message.reactions.findIndex(
      (r) => r.userId.toString() === req.user._id.toString() && r.emoji === emoji
    );

    if (existingIdx > -1) {
      // Remove reaction
      message.reactions.splice(existingIdx, 1);
    } else {
      // Add reaction
      message.reactions.push({
        userId: req.user._id,
        emoji,
        createdAt: new Date(),
      });
    }

    await message.save();

    const io = getIO();
    if (io) {
      io.to(message.roomId.toString()).emit("chat:reaction:update", {
        messageId: message._id,
        reactions: message.reactions,
      });
    }

    res.json({ reactions: message.reactions });
  } catch (err) {
    console.error("Error toggling reaction:", err);
    res.status(500).json({ message: "Server error handling reaction" });
  }
};

// @desc    Report a message
// @route   POST /api/chat/messages/:id/report
// @access  Private
const reportMessage = async (req, res) => {
  try {
    const { reason, details } = req.body;
    if (!reason) {
      return res.status(400).json({ message: "Report reason is required" });
    }

    const message = await LiveChatMessage.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    const existing = await ChatReport.findOne({
      messageId: message._id,
      reportedBy: req.user._id,
      status: "Pending",
    });

    if (existing) {
      return res.status(400).json({ message: "You have already submitted a pending report for this message" });
    }

    const report = await ChatReport.create({
      messageId: message._id,
      reportedBy: req.user._id,
      reason,
      details: details || "",
    });

    const io = getIO();
    if (io) {
      io.to("admin_room").emit("admin:report:new", report);
    }

    res.status(201).json({ message: "Report submitted successfully", report });
  } catch (err) {
    console.error("Error reporting message:", err);
    res.status(500).json({ message: "Server error processing report" });
  }
};

// @desc    Block or Unblock member
// @route   POST /api/chat/members/:id/block
// @access  Private
const toggleBlockUser = async (req, res) => {
  try {
    const targetUserId = req.params.id;
    if (targetUserId === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    const existing = await UserBlock.findOne({
      blockerId: req.user._id,
      blockedUserId: targetUserId,
    });

    if (existing) {
      await UserBlock.findByIdAndDelete(existing._id);
      return res.json({ isBlocked: false, message: "User unblocked" });
    } else {
      await UserBlock.create({
        blockerId: req.user._id,
        blockedUserId: targetUserId,
      });
      return res.json({ isBlocked: true, message: "User blocked" });
    }
  } catch (err) {
    console.error("Error blocking/unblocking user:", err);
    res.status(500).json({ message: "Server error blocking member" });
  }
};

// @desc    Get blocked users list
// @route   GET /api/chat/members/blocked
// @access  Private
const getBlockedUsers = async (req, res) => {
  try {
    const blocks = await UserBlock.find({ blockerId: req.user._id }).populate("blockedUserId", "name username avatar");
    res.json(blocks.map((b) => b.blockedUserId));
  } catch (err) {
    res.status(500).json({ message: "Error fetching blocked users" });
  }
};

// @desc    Get unread count for global room
// @route   GET /api/chat/unread-count
// @access  Private
const getUnreadCount = async (req, res) => {
  try {
    const globalRoom = await ChatRoom.findOne({ type: "global" });
    if (!globalRoom) return res.json({ unreadCount: 0 });

    const readState = await ChatReadState.findOne({
      userId: req.user._id,
      roomId: globalRoom._id,
    });

    let unreadCount = 0;
    if (readState && readState.lastReadAt) {
      unreadCount = await LiveChatMessage.countDocuments({
        roomId: globalRoom._id,
        createdAt: { $gt: readState.lastReadAt },
        senderId: { $ne: req.user._id },
        isDeleted: false,
      });
    } else {
      unreadCount = await LiveChatMessage.countDocuments({
        roomId: globalRoom._id,
        senderId: { $ne: req.user._id },
        isDeleted: false,
      });
    }

    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: "Error calculation unread count" });
  }
};

// @desc    Update read state
// @route   PATCH /api/chat/read-state
// @access  Private
const updateReadState = async (req, res) => {
  try {
    const { lastReadMessageId } = req.body;
    const globalRoom = await ChatRoom.findOne({ type: "global" });
    if (!globalRoom) return res.status(404).json({ message: "Room not found" });

    await ChatReadState.findOneAndUpdate(
      { userId: req.user._id, roomId: globalRoom._id },
      { lastReadMessageId: lastReadMessageId || null, lastReadAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ success: true, unreadCount: 0 });
  } catch (err) {
    res.status(500).json({ message: "Error updating read state" });
  }
};

// @desc    Update chat mute notifications setting
// @route   PATCH /api/chat/mute-notifications
// @access  Private
const updateMuteNotifications = async (req, res) => {
  try {
    const { durationHours, manualMute } = req.body; // durationHours: 1, 8, 'end_of_day', or 0 to unmute

    let muteUntil = null;
    const now = new Date();

    if (manualMute) {
      muteUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year far future
    } else if (durationHours === "end_of_day") {
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      muteUntil = endOfDay;
    } else if (typeof durationHours === "number" && durationHours > 0) {
      muteUntil = new Date(now.getTime() + durationHours * 3600 * 1000);
    }

    req.user.chatMuteNotificationsUntil = muteUntil;
    await req.user.save();

    res.json({
      message: muteUntil ? "Notifications muted" : "Notifications unmuted",
      chatMuteNotificationsUntil: muteUntil,
    });
  } catch (err) {
    res.status(500).json({ message: "Error updating notification settings" });
  }
};

// @desc    Search eligible users for @mentions
// @route   GET /api/chat/users/search
// @access  Private
const searchUsersForMention = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json([]);

    const regex = new RegExp(q.trim(), "i");
    const users = await User.find({
      $or: [{ name: regex }, { username: regex }],
      status: "Active",
    })
      .select("name username avatar role")
      .limit(10);

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Error searching users" });
  }
};

module.exports = {
  getMessages,
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
};
