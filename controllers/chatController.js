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
// @desc    Get paginated chat messages for room (global, direct, or circle)
// @route   GET /api/chat/rooms/global/messages
// @route   GET /api/chat/rooms/:roomId/messages
// @access  Private
const getMessages = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const { cursor, roomId: queryRoomId } = req.query;
    const targetRoomId = req.params.roomId || queryRoomId;

    let targetRoom = null;
    if (targetRoomId && targetRoomId !== "global") {
      targetRoom = await ChatRoom.findById(targetRoomId);
    } else {
      targetRoom = await ChatRoom.findOne({ type: "global" });
    }

    if (!targetRoom) {
      return res.status(200).json({ messages: [], nextCursor: null, hasMore: false, room: null });
    }

    // Check direct message permission
    if (targetRoom.type === "direct") {
      const isParticipant = targetRoom.participants.some((p) => p.toString() === req.user._id.toString());
      if (!isParticipant && req.user.role !== "admin") {
        return res.status(403).json({ message: "Not authorized to access this conversation" });
      }
    }

    // Get list of blocked user IDs for the current user
    const blockedRecords = await UserBlock.find({ blockerId: req.user._id });
    const blockedUserIds = blockedRecords.map((b) => b.blockedUserId.toString());

    // Query filter
    const query = {
      roomId: targetRoom._id,
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
      room: targetRoom,
    });
  } catch (err) {
    console.error("Error fetching chat messages:", err);
    res.status(500).json({ message: "Server error fetching chat history" });
  }
};

// @desc    Get user's conversations list (Direct DMs, Circles, Global Room)
// @route   GET /api/chat/conversations
// @access  Private
const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const rooms = await ChatRoom.find({
      $or: [
        { type: "global" },
        { type: "circle" },
        { type: "direct", participants: userId },
      ],
    }).populate("participants", "name username avatar role status");

    const conversationList = await Promise.all(
      rooms.map(async (r) => {
        let recipient = null;
        if (r.type === "direct") {
          recipient = r.participants.find((p) => p._id.toString() !== userId.toString()) || null;
        }

        const latestMessage = await LiveChatMessage.findOne({
          roomId: r._id,
          isDeleted: false,
        })
          .sort({ createdAt: -1 })
          .populate("senderId", "name username");

        const readState = await ChatReadState.findOne({
          userId,
          roomId: r._id,
        });

        let unreadCount = 0;
        if (readState && readState.lastReadAt) {
          unreadCount = await LiveChatMessage.countDocuments({
            roomId: r._id,
            createdAt: { $gt: readState.lastReadAt },
            senderId: { $ne: userId },
            isDeleted: false,
          });
        } else {
          unreadCount = await LiveChatMessage.countDocuments({
            roomId: r._id,
            senderId: { $ne: userId },
            isDeleted: false,
          });
        }

        return {
          roomId: r._id,
          name: r.type === "direct" && recipient ? recipient.name : r.name,
          type: r.type,
          description: r.description,
          icon: r.icon,
          recipient,
          participantsCount: r.participants ? r.participants.length : 0,
          isMember: r.type === "circle" ? r.participants.some((p) => (p._id || p).toString() === userId.toString()) : true,
          latestMessage,
          unreadCount,
          updatedAt: latestMessage ? latestMessage.createdAt : r.updatedAt,
        };
      })
    );

    conversationList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json(conversationList);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ message: "Server error fetching conversations" });
  }
};

// @desc    Start or get direct 1-to-1 conversation with student/mentor
// @route   POST /api/chat/conversations/direct
// @access  Private
const startDirectConversation = async (req, res) => {
  try {
    const { recipientId } = req.body;
    const userId = req.user._id;

    if (!recipientId) {
      return res.status(400).json({ message: "Recipient ID is required" });
    }

    if (recipientId === userId.toString()) {
      return res.status(400).json({ message: "Cannot start a conversation with yourself" });
    }

    // Check if either user has blocked the other
    const isBlocked = await UserBlock.findOne({
      $or: [
        { blockerId: userId, blockedUserId: recipientId },
        { blockerId: recipientId, blockedUserId: userId },
      ],
    });

    if (isBlocked) {
      return res.status(403).json({ message: "Cannot start a conversation with this user due to privacy settings or blocking" });
    }

    const recipientUser = await User.findById(recipientId).select("name username avatar role status");
    if (!recipientUser) {
      return res.status(404).json({ message: "Recipient user not found" });
    }

    let room = await ChatRoom.findOne({
      type: "direct",
      participants: { $all: [userId, recipientId], $size: 2 },
    }).populate("participants", "name username avatar role status");

    if (!room) {
      room = await ChatRoom.create({
        name: `DM_${userId}_${recipientId}`,
        type: "direct",
        participants: [userId, recipientId],
        createdBy: userId,
      });
      room = await room.populate("participants", "name username avatar role status");
    }

    res.status(200).json({
      roomId: room._id,
      name: recipientUser.name,
      type: "direct",
      recipient: recipientUser,
      room,
    });
  } catch (err) {
    console.error("Error starting direct conversation:", err);
    res.status(500).json({ message: "Server error starting conversation" });
  }
};

// @desc    Get all community circles
// @route   GET /api/chat/circles
// @access  Private
const getCircles = async (req, res) => {
  try {
    const userId = req.user._id;
    const circles = await ChatRoom.find({ type: "circle" }).sort({ createdAt: 1 });

    const formatted = circles.map((c) => ({
      _id: c._id,
      roomId: c._id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      type: "circle",
      membersCount: c.participants ? c.participants.length : 0,
      isMember: c.participants ? c.participants.some((p) => p.toString() === userId.toString()) : false,
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching circles:", err);
    res.status(500).json({ message: "Server error fetching circles" });
  }
};

// @desc    Join or leave a community circle
// @route   POST /api/chat/circles/:id/join
// @access  Private
const toggleJoinCircle = async (req, res) => {
  try {
    const circleId = req.params.id;
    const userId = req.user._id;

    const circle = await ChatRoom.findOne({ _id: circleId, type: "circle" });
    if (!circle) {
      return res.status(404).json({ message: "Circle not found" });
    }

    const memberIndex = circle.participants.findIndex((p) => p.toString() === userId.toString());
    let isMember = false;

    if (memberIndex > -1) {
      circle.participants.splice(memberIndex, 1);
      isMember = false;
    } else {
      circle.participants.push(userId);
      isMember = true;
    }

    await circle.save();

    res.json({
      circleId: circle._id,
      isMember,
      membersCount: circle.participants.length,
      message: isMember ? "Joined circle" : "Left circle",
    });
  } catch (err) {
    console.error("Error toggling circle membership:", err);
    res.status(500).json({ message: "Server error updating circle membership" });
  }
};

// @desc    Create a new community circle (Admin / Mentors / Community Builders)
// @route   POST /api/chat/circles
// @access  Private
const createCircle = async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Circle name is required" });
    }

    const existing = await ChatRoom.findOne({ name: name.trim(), type: "circle" });
    if (existing) {
      return res.status(400).json({ message: "A community circle with this name already exists" });
    }

    const newCircle = await ChatRoom.create({
      name: name.trim(),
      description: description ? description.trim() : "",
      icon: icon || "💬",
      type: "circle",
      createdBy: req.user._id,
      participants: [req.user._id],
    });

    res.status(201).json({
      _id: newCircle._id,
      roomId: newCircle._id,
      name: newCircle.name,
      description: newCircle.description,
      icon: newCircle.icon,
      type: "circle",
      membersCount: 1,
      isMember: true,
    });
  } catch (err) {
    console.error("Error creating circle:", err);
    res.status(500).json({ message: "Server error creating community circle" });
  }
};

// @desc    Delete a community circle (Admin / Creator)
// @route   DELETE /api/chat/circles/:id
// @access  Private
const deleteCircle = async (req, res) => {
  try {
    const circleId = req.params.id;
    const circle = await ChatRoom.findOne({ _id: circleId, type: "circle" });

    if (!circle) {
      return res.status(404).json({ message: "Community circle not found" });
    }

    if (req.user.role !== "admin" && circle.createdBy && circle.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to delete this circle" });
    }

    await LiveChatMessage.deleteMany({ roomId: circle._id });
    await ChatRoom.findByIdAndDelete(circle._id);

    res.json({ message: "Community circle deleted successfully", circleId: circle._id });
  } catch (err) {
    console.error("Error deleting circle:", err);
    res.status(500).json({ message: "Server error deleting circle" });
  }
};

// @desc    Send a new message (REST endpoint)
// @route   POST /api/chat/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { content, replyToId, linkedOpportunityId, mentions, attachmentUrl, attachmentType, attachmentName, roomId: bodyRoomId } = req.body;

    let targetRoom = null;
    if (bodyRoomId) {
      targetRoom = await ChatRoom.findById(bodyRoomId);
    } else {
      targetRoom = await ChatRoom.findOne({ type: "global" });
    }

    if (!targetRoom) {
      return res.status(404).json({ message: "Room not found" });
    }

    // Direct room validation
    if (targetRoom.type === "direct") {
      const isParticipant = targetRoom.participants.some((p) => p.toString() === req.user._id.toString());
      if (!isParticipant && req.user.role !== "admin") {
        return res.status(403).json({ message: "Not authorized to send messages in this conversation" });
      }

      const recipientId = targetRoom.participants.find((p) => p.toString() !== req.user._id.toString());
      if (recipientId) {
        const isBlocked = await UserBlock.findOne({
          $or: [
            { blockerId: req.user._id, blockedUserId: recipientId },
            { blockerId: recipientId, blockedUserId: req.user._id },
          ],
        });
        if (isBlocked) {
          return res.status(403).json({ message: "Cannot send message due to privacy/blocking settings" });
        }
      }
    }

    const check = await validateUserCanPost(req.user._id, targetRoom._id);
    if (!check.allowed) {
      return res.status(403).json({ message: check.reason, remainingSeconds: check.remainingSeconds });
    }

    const spamEval = await evaluateMessageSpam(req.user._id, targetRoom._id, content);

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
      roomId: targetRoom._id,
      senderId: req.user._id,
      displayNameSnapshot: req.user.name,
      content: content ? content.trim() : "",
      replyToId: replyRef,
      linkedOpportunityId: opportunityRef,
      attachmentUrl: attachmentUrl || "",
      attachmentType: attachmentType || "",
      attachmentName: attachmentName || "",
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
      io.to(targetRoom._id.toString()).emit("chat:new", populatedMsg);

      if (targetRoom.type === "direct") {
        const recipientId = targetRoom.participants.find((p) => p.toString() !== req.user._id.toString());
        if (recipientId) {
          io.to(`user_${recipientId.toString()}`).emit("chat:new", populatedMsg);

          const recipientUser = await User.findById(recipientId);
          const isMuted = recipientUser && recipientUser.chatMuteNotificationsUntil && recipientUser.chatMuteNotificationsUntil > new Date();
          if (!isMuted) {
            io.to(`user_${recipientId.toString()}`).emit("notification:new", {
              title: `New message from ${req.user.name}`,
              notes: content ? (content.length > 50 ? content.substring(0, 50) + "..." : content) : "Sent an attachment",
              type: "chat_dm",
              roomId: targetRoom._id,
            });
          }
        }
      }
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

      // Send reaction notification to message sender if different user
      if (message.senderId.toString() !== req.user._id.toString()) {
        const messageSender = await User.findById(message.senderId);
        const isMuted = messageSender && messageSender.chatMuteNotificationsUntil && messageSender.chatMuteNotificationsUntil > new Date();
        if (!isMuted) {
          io.to(`user_${message.senderId.toString()}`).emit("notification:new", {
            title: `${req.user.name} reacted ${emoji} to your message`,
            notes: message.content ? (message.content.length > 40 ? message.content.substring(0, 40) + "..." : message.content) : "Message reaction",
            type: "chat_reaction",
            roomId: message.roomId,
          });
        }
      }
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

// @desc    Get unread count for rooms or total
// @route   GET /api/chat/unread-count
// @access  Private
const getUnreadCount = async (req, res) => {
  try {
    const { roomId: queryRoomId } = req.query;

    if (queryRoomId) {
      const readState = await ChatReadState.findOne({
        userId: req.user._id,
        roomId: queryRoomId,
      });

      let unreadCount = 0;
      if (readState && readState.lastReadAt) {
        unreadCount = await LiveChatMessage.countDocuments({
          roomId: queryRoomId,
          createdAt: { $gt: readState.lastReadAt },
          senderId: { $ne: req.user._id },
          isDeleted: false,
        });
      } else {
        unreadCount = await LiveChatMessage.countDocuments({
          roomId: queryRoomId,
          senderId: { $ne: req.user._id },
          isDeleted: false,
        });
      }
      return res.json({ unreadCount });
    }

    const userRooms = await ChatRoom.find({
      $or: [
        { type: "global" },
        { type: "circle" },
        { type: "direct", participants: req.user._id },
      ],
    });

    let totalUnread = 0;
    for (const room of userRooms) {
      const readState = await ChatReadState.findOne({
        userId: req.user._id,
        roomId: room._id,
      });

      let count = 0;
      if (readState && readState.lastReadAt) {
        count = await LiveChatMessage.countDocuments({
          roomId: room._id,
          createdAt: { $gt: readState.lastReadAt },
          senderId: { $ne: req.user._id },
          isDeleted: false,
        });
      } else {
        count = await LiveChatMessage.countDocuments({
          roomId: room._id,
          senderId: { $ne: req.user._id },
          isDeleted: false,
        });
      }
      totalUnread += count;
    }

    res.json({ unreadCount: totalUnread });
  } catch (err) {
    res.status(500).json({ message: "Error calculating unread count" });
  }
};

// @desc    Update read state for room
// @route   PATCH /api/chat/read-state
// @access  Private
const updateReadState = async (req, res) => {
  try {
    const { lastReadMessageId, roomId: bodyRoomId } = req.body;
    let targetRoomId = bodyRoomId;

    if (!targetRoomId) {
      const globalRoom = await ChatRoom.findOne({ type: "global" });
      if (globalRoom) targetRoomId = globalRoom._id;
    }

    if (!targetRoomId) return res.status(404).json({ message: "Room not found" });

    await ChatReadState.findOneAndUpdate(
      { userId: req.user._id, roomId: targetRoomId },
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

// @desc    Search eligible users for @mentions or starting DMs
// @route   GET /api/chat/users/search
// @access  Private
const searchUsersForMention = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json([]);

    const regex = new RegExp(q.trim(), "i");
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ name: regex }, { username: regex }],
      status: "Active",
    })
      .select("name username avatar role school")
      .limit(10);

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Error searching users" });
  }
};

module.exports = {
  getMessages,
  getConversations,
  startDirectConversation,
  getCircles,
  toggleJoinCircle,
  createCircle,
  deleteCircle,
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
