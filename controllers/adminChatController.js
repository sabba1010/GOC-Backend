const LiveChatMessage = require("../models/LiveChatMessage");
const ChatRoom = require("../models/ChatRoom");
const ChatReport = require("../models/ChatReport");
const ChatModerationAction = require("../models/ChatModerationAction");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const { getIO } = require("../socket/chatSocket");

// @desc    Get admin chat messages with comprehensive filters
// @route   GET /api/admin/chat/messages
// @access  Private (Admin)
const getAdminMessages = async (req, res) => {
  try {
    const { keyword, senderId, opportunityId, startDate, endDate, limit = 50, page = 1 } = req.query;

    const query = {};

    if (keyword) {
      query.content = new RegExp(keyword.trim(), "i");
    }

    if (senderId) {
      query.senderId = senderId;
    }

    if (opportunityId) {
      query.linkedOpportunityId = opportunityId;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await LiveChatMessage.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("senderId", "name username email avatar status role chatMutedUntil chatRestrictedUntil chatAccessRevoked")
      .populate("linkedOpportunityId", "title organization category")
      .populate("deletedBy", "name username");

    const total = await LiveChatMessage.countDocuments(query);

    res.json({
      messages,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error("Error fetching admin messages:", err);
    res.status(500).json({ message: "Server error fetching chat history" });
  }
};

// @desc    Get report queue
// @route   GET /api/admin/chat/reports
// @access  Private (Admin)
const getReports = async (req, res) => {
  try {
    const { status = "Pending" } = req.query;

    const query = status === "all" ? {} : { status };

    const reports = await ChatReport.find(query)
      .sort({ createdAt: -1 })
      .populate("reportedBy", "name username email avatar")
      .populate("reviewedBy", "name username")
      .populate({
        path: "messageId",
        populate: { path: "senderId", select: "name username email avatar status" },
      });

    res.json(reports);
  } catch (err) {
    console.error("Error fetching reports:", err);
    res.status(500).json({ message: "Server error fetching reports" });
  }
};

// @desc    Update report status
// @route   PATCH /api/admin/chat/reports/:id/status
// @access  Private (Admin)
const updateReportStatus = async (req, res) => {
  try {
    const { status, actionTaken } = req.body;
    const report = await ChatReport.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    report.status = status || report.status;
    report.actionTaken = actionTaken || report.actionTaken;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    await report.save();

    await AuditLog.create({
      actor: req.user._id,
      action: "UPDATE_REPORT_STATUS",
      targetType: "ChatReport",
      targetId: report._id.toString(),
      reason: actionTaken || `Updated status to ${status}`,
      newValue: { status: report.status, actionTaken: report.actionTaken },
    });

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: "Error updating report status" });
  }
};

// @desc    Get automated moderation flags
// @route   GET /api/admin/chat/flags
// @access  Private (Admin)
const getModerationFlags = async (req, res) => {
  try {
    const flaggedMessages = await LiveChatMessage.find({ moderationStatus: "flagged" })
      .sort({ createdAt: -1 })
      .populate("senderId", "name username email avatar status");

    res.json(flaggedMessages);
  } catch (err) {
    res.status(500).json({ message: "Error fetching moderation flags" });
  }
};

// @desc    Remove message as Admin
// @route   POST /api/admin/chat/messages/:id/remove
// @access  Private (Admin)
const removeMessage = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required for message removal" });

    const message = await LiveChatMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ message: "Message not found" });

    const prevDeleted = message.isDeleted;
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.deleteReason = reason;
    message.moderationStatus = "removed";
    await message.save();

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: message.senderId,
      messageId: message._id,
      action: "Remove Message",
      reason,
      previousState: { isDeleted: prevDeleted },
      newState: { isDeleted: true, deleteReason: reason },
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "REMOVE_CHAT_MESSAGE",
      targetType: "LiveChatMessage",
      targetId: message._id.toString(),
      reason,
    });

    const io = getIO();
    if (io) {
      io.to(message.roomId.toString()).emit("chat:deleted", { messageId: message._id });
    }

    res.json({ message: "Message removed", id: message._id });
  } catch (err) {
    res.status(500).json({ message: "Error removing message" });
  }
};

// @desc    Restore message as Admin
// @route   POST /api/admin/chat/messages/:id/restore
// @access  Private (Admin)
const restoreMessage = async (req, res) => {
  try {
    const { reason } = req.body;
    const message = await LiveChatMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ message: "Message not found" });

    message.isDeleted = false;
    message.deletedAt = null;
    message.deletedBy = null;
    message.deleteReason = "";
    message.moderationStatus = "clean";
    await message.save();

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: message.senderId,
      messageId: message._id,
      action: "Restore Message",
      reason: reason || "Admin restored message",
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "RESTORE_CHAT_MESSAGE",
      targetType: "LiveChatMessage",
      targetId: message._id.toString(),
      reason: reason || "Restored message",
    });

    const populatedMsg = await LiveChatMessage.findById(message._id)
      .populate("senderId", "name username avatar role")
      .populate("linkedOpportunityId", "title organization category deadline image");

    const io = getIO();
    if (io) {
      io.to(message.roomId.toString()).emit("chat:new", populatedMsg);
    }

    res.json({ message: "Message restored", restoredMessage: populatedMsg });
  } catch (err) {
    res.status(500).json({ message: "Error restoring message" });
  }
};

// @desc    Warn a user
// @route   POST /api/admin/chat/members/:id/warn
// @access  Private (Admin)
const warnMember = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required to send warning" });

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: targetUser._id,
      action: "Warn",
      reason,
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "WARN_MEMBER",
      targetType: "User",
      targetId: targetUser._id.toString(),
      reason,
    });

    res.json({ message: `Warning issued to ${targetUser.name}` });
  } catch (err) {
    res.status(500).json({ message: "Error warning member" });
  }
};

// @desc    Temporarily mute user
// @route   POST /api/admin/chat/members/:id/mute
// @access  Private (Admin)
const muteMember = async (req, res) => {
  try {
    const { durationMinutes = 60, reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required for muting user" });

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const expiresAt = new Date(Date.now() + parseInt(durationMinutes) * 60000);

    const prevMute = targetUser.chatMutedUntil;
    targetUser.chatMutedUntil = expiresAt;
    await targetUser.save();

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: targetUser._id,
      action: "Mute",
      reason,
      expiresAt,
      previousState: { chatMutedUntil: prevMute },
      newState: { chatMutedUntil: expiresAt },
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "MUTE_MEMBER",
      targetType: "User",
      targetId: targetUser._id.toString(),
      reason: `${reason} (Duration: ${durationMinutes} mins)`,
    });

    res.json({ message: `${targetUser.name} muted for ${durationMinutes} minutes`, expiresAt });
  } catch (err) {
    res.status(500).json({ message: "Error muting member" });
  }
};

// @desc    Restrict user from posting
// @route   POST /api/admin/chat/members/:id/restrict
// @access  Private (Admin)
const restrictMember = async (req, res) => {
  try {
    const { durationHours = 24, reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required for restriction" });

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const expiresAt = new Date(Date.now() + parseFloat(durationHours) * 3600000);

    const prevRestricted = targetUser.chatRestrictedUntil;
    targetUser.chatRestrictedUntil = expiresAt;
    await targetUser.save();

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: targetUser._id,
      action: "Restrict",
      reason,
      expiresAt,
      previousState: { chatRestrictedUntil: prevRestricted },
      newState: { chatRestrictedUntil: expiresAt },
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "RESTRICT_MEMBER",
      targetType: "User",
      targetId: targetUser._id.toString(),
      reason: `${reason} (Duration: ${durationHours} hrs)`,
    });

    res.json({ message: `${targetUser.name} restricted for ${durationHours} hours`, expiresAt });
  } catch (err) {
    res.status(500).json({ message: "Error restricting member" });
  }
};

// @desc    Revoke chat access
// @route   POST /api/admin/chat/members/:id/remove-access
// @access  Private (Admin)
const removeAccess = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required for revoking chat access" });

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    targetUser.chatAccessRevoked = true;
    await targetUser.save();

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: targetUser._id,
      action: "Remove Chat Access",
      reason,
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "REMOVE_CHAT_ACCESS",
      targetType: "User",
      targetId: targetUser._id.toString(),
      reason,
    });

    res.json({ message: `Chat access revoked for ${targetUser.name}` });
  } catch (err) {
    res.status(500).json({ message: "Error revoking chat access" });
  }
};

// @desc    Restore chat access & clear restrictions
// @route   POST /api/admin/chat/members/:id/restore
// @access  Private (Admin)
const restoreAccess = async (req, res) => {
  try {
    const { reason } = req.body;
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    targetUser.chatMutedUntil = null;
    targetUser.chatRestrictedUntil = null;
    targetUser.chatAccessRevoked = false;
    await targetUser.save();

    await ChatModerationAction.create({
      adminId: req.user._id,
      targetUserId: targetUser._id,
      action: "Restore Access",
      reason: reason || "Admin restored access",
    });

    await AuditLog.create({
      actor: req.user._id,
      action: "RESTORE_CHAT_ACCESS",
      targetType: "User",
      targetId: targetUser._id.toString(),
      reason: reason || "Restored chat access",
    });

    res.json({ message: `Chat access restored for ${targetUser.name}` });
  } catch (err) {
    res.status(500).json({ message: "Error restoring access" });
  }
};

// @desc    Pause global chat room
// @route   POST /api/admin/chat/room/pause
// @access  Private (Admin)
const pauseRoom = async (req, res) => {
  try {
    const { reason } = req.body;
    let room = await ChatRoom.findOne({ type: "global" });
    if (!room) return res.status(404).json({ message: "Global room not found" });

    room.isPaused = true;
    room.pauseReason = reason || "Chat is temporarily paused for moderation.";
    room.pausedAt = new Date();
    room.pausedBy = req.user._id;
    await room.save();

    await AuditLog.create({
      actor: req.user._id,
      action: "PAUSE_CHAT_ROOM",
      targetType: "ChatRoom",
      targetId: room._id.toString(),
      reason: room.pauseReason,
    });

    const io = getIO();
    if (io) {
      io.to(room._id.toString()).emit("chat:room:update", room);
    }

    res.json({ message: "Chat room paused", room });
  } catch (err) {
    res.status(500).json({ message: "Error pausing room" });
  }
};

// @desc    Resume global chat room
// @route   POST /api/admin/chat/room/resume
// @access  Private (Admin)
const resumeRoom = async (req, res) => {
  try {
    let room = await ChatRoom.findOne({ type: "global" });
    if (!room) return res.status(404).json({ message: "Global room not found" });

    room.isPaused = false;
    room.pauseReason = "";
    room.pausedAt = null;
    room.pausedBy = null;
    await room.save();

    await AuditLog.create({
      actor: req.user._id,
      action: "RESUME_CHAT_ROOM",
      targetType: "ChatRoom",
      targetId: room._id.toString(),
      reason: "Resumed by admin",
    });

    const io = getIO();
    if (io) {
      io.to(room._id.toString()).emit("chat:room:update", room);
    }

    res.json({ message: "Chat room resumed", room });
  } catch (err) {
    res.status(500).json({ message: "Error resuming room" });
  }
};

// @desc    Update slow mode settings
// @route   PATCH /api/admin/chat/room/slow-mode
// @access  Private (Admin)
const setSlowMode = async (req, res) => {
  try {
    const { slowModeEnabled, slowModeSeconds } = req.body;

    let room = await ChatRoom.findOne({ type: "global" });
    if (!room) return res.status(404).json({ message: "Global room not found" });

    room.slowModeEnabled = typeof slowModeEnabled === "boolean" ? slowModeEnabled : room.slowModeEnabled;
    room.slowModeSeconds = typeof slowModeSeconds === "number" ? slowModeSeconds : room.slowModeSeconds;
    room.updatedBy = req.user._id;
    await room.save();

    await AuditLog.create({
      actor: req.user._id,
      action: "SET_SLOW_MODE",
      targetType: "ChatRoom",
      targetId: room._id.toString(),
      reason: `Slow mode: ${room.slowModeEnabled ? `${room.slowModeSeconds}s` : "disabled"}`,
    });

    const io = getIO();
    if (io) {
      io.to(room._id.toString()).emit("chat:room:update", room);
    }

    res.json({ message: "Slow mode updated", room });
  } catch (err) {
    res.status(500).json({ message: "Error setting slow mode" });
  }
};

// @desc    Pin an announcement message
// @route   POST /api/admin/chat/messages/:id/pin
// @access  Private (Admin)
const pinMessage = async (req, res) => {
  try {
    const message = await LiveChatMessage.findById(req.params.id).populate("senderId", "name");
    if (!message || message.isDeleted) return res.status(404).json({ message: "Message not found" });

    let room = await ChatRoom.findOne({ type: "global" });
    if (!room) return res.status(404).json({ message: "Global room not found" });

    room.pinnedMessageId = message._id;
    room.pinnedAt = new Date();
    room.pinnedBy = req.user._id;
    await room.save();

    await AuditLog.create({
      actor: req.user._id,
      action: "PIN_MESSAGE",
      targetType: "LiveChatMessage",
      targetId: message._id.toString(),
      reason: "Pinned announcement",
    });

    const io = getIO();
    if (io) {
      io.to(room._id.toString()).emit("chat:pinned:update", {
        pinnedMessage: message,
        pinnedAt: room.pinnedAt,
      });
    }

    res.json({ message: "Message pinned", room, pinnedMessage: message });
  } catch (err) {
    res.status(500).json({ message: "Error pinning message" });
  }
};

// @desc    Unpin message
// @route   DELETE /api/admin/chat/pinned/:id
// @access  Private (Admin)
const unpinMessage = async (req, res) => {
  try {
    let room = await ChatRoom.findOne({ type: "global" });
    if (!room) return res.status(404).json({ message: "Global room not found" });

    room.pinnedMessageId = null;
    room.pinnedAt = null;
    room.pinnedBy = null;
    await room.save();

    await AuditLog.create({
      actor: req.user._id,
      action: "UNPIN_MESSAGE",
      targetType: "ChatRoom",
      targetId: room._id.toString(),
      reason: "Unpinned message",
    });

    const io = getIO();
    if (io) {
      io.to(room._id.toString()).emit("chat:pinned:update", {
        pinnedMessage: null,
      });
    }

    res.json({ message: "Message unpinned", room });
  } catch (err) {
    res.status(500).json({ message: "Error unpinning message" });
  }
};

// @desc    Get moderation audit logs
// @route   GET /api/admin/chat/audit-logs
// @access  Private (Admin)
const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("actor", "name username email avatar");

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: "Error fetching audit logs" });
  }
};

module.exports = {
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
};
