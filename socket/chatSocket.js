const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ChatRoom = require("../models/ChatRoom");
const LiveChatMessage = require("../models/LiveChatMessage");
const ChatReadState = require("../models/ChatReadState");
const ChatReport = require("../models/ChatReport");
const Opportunity = require("../models/Opportunity");
const { validateUserCanPost, evaluateMessageSpam } = require("../services/chatModeration");

let ioInstance = null;

const initGlobalRoom = async () => {
  try {
    let globalRoom = await ChatRoom.findOne({ type: "global" });
    if (!globalRoom) {
      globalRoom = await ChatRoom.create({
        name: "Global Chat",
        type: "global",
      });
      console.log("🌸 Global Chat Room created in DB:", globalRoom._id);
    }
    return globalRoom;
  } catch (err) {
    console.error("Error initializing global chat room:", err);
  }
};

const setupChatSocket = (io) => {
  ioInstance = io;

  // Initialize room
  initGlobalRoom();

  // Socket Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
        socket.handshake.query?.token;

      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");

      if (!user) {
        return next(new Error("Authentication error: User not found"));
      }

      if (user.status === "Suspended") {
        return next(new Error("Authentication error: User account is suspended"));
      }

      if (user.chatAccessRevoked) {
        return next(new Error("Authentication error: User chat access is revoked"));
      }

      socket.user = user;
      next();
    } catch (err) {
      return next(new Error("Authentication error: Invalid or expired token"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.user;
    console.log(`💬 User connected to Chat Socket: ${user.name} (@${user.username})`);

    const globalRoom = await ChatRoom.findOne({ type: "global" });
    const roomId = globalRoom ? globalRoom._id.toString() : "global";

    // Auto-join global chat room channel
    socket.join(roomId);
    socket.join(`user_${user._id}`);

    // Send initial room status to connected user
    if (globalRoom) {
      socket.emit("chat:room:update", globalRoom);
    }

    // ── EVENT: chat:join ─────────────────────────
    socket.on("chat:join", () => {
      socket.join(roomId);
    });

    // ── EVENT: chat:send ─────────────────────────
    socket.on("chat:send", async (data, callback) => {
      try {
        const { content, replyToId, linkedOpportunityId, mentions } = data || {};

        if ((!content || !content.trim()) && !linkedOpportunityId) {
          if (typeof callback === "function") callback({ error: "Message content or opportunity is required" });
          return;
        }

        // 1. Validate restrictions/mute/slow mode/room paused
        const check = await validateUserCanPost(user._id, roomId);
        if (!check.allowed) {
          if (typeof callback === "function") callback({ error: check.reason, remainingSeconds: check.remainingSeconds });
          socket.emit("chat:error", { message: check.reason, remainingSeconds: check.remainingSeconds });
          return;
        }

        // 2. Evaluate Spam / Keyword Flags
        const spamEval = await evaluateMessageSpam(user._id, roomId, content);

        // 3. Verify Opportunity if provided
        let opportunityRef = null;
        if (linkedOpportunityId) {
          const opp = await Opportunity.findById(linkedOpportunityId);
          if (opp && opp.status === "Published") {
            opportunityRef = opp._id;
          } else {
            if (typeof callback === "function") callback({ error: "Opportunity not found or not published" });
            return;
          }
        }

        // 4. Verify Reply target if provided
        let replyRef = null;
        if (replyToId) {
          const targetMsg = await LiveChatMessage.findById(replyToId);
          if (targetMsg) replyRef = targetMsg._id;
        }

        // 5. Create Message in Database
        const newMsg = await LiveChatMessage.create({
          roomId,
          senderId: user._id,
          displayNameSnapshot: user.name,
          content: content ? content.trim() : "",
          replyToId: replyRef,
          linkedOpportunityId: opportunityRef,
          mentions: Array.isArray(mentions) ? mentions : [],
          moderationStatus: spamEval.isFlagged ? "flagged" : "clean",
          moderationFlags: spamEval.flags,
        });

        // 6. Populate message references for broadcast
        const populatedMsg = await LiveChatMessage.findById(newMsg._id)
          .populate("senderId", "name username avatar role")
          .populate({
            path: "replyToId",
            select: "content displayNameSnapshot senderId",
            populate: { path: "senderId", select: "name" },
          })
          .populate("linkedOpportunityId", "title organization category deadline image status")
          .populate("mentions", "name username");

        // 7. Broadcast new message to room
        io.to(roomId).emit("chat:new", populatedMsg);

        if (typeof callback === "function") callback({ success: true, message: populatedMsg });
      } catch (err) {
        console.error("Error sending chat message:", err);
        if (typeof callback === "function") callback({ error: "Failed to send message" });
      }
    });

    // ── EVENT: chat:reaction:add ─────────────────
    socket.on("chat:reaction:add", async ({ messageId, emoji }, callback) => {
      try {
        if (!messageId || !emoji) return;

        const message = await LiveChatMessage.findById(messageId);
        if (!message || message.isDeleted) return;

        // Toggle rule: check if user already reacted with this emoji
        const existingIdx = message.reactions.findIndex(
          (r) => r.userId.toString() === user._id.toString() && r.emoji === emoji
        );

        if (existingIdx === -1) {
          message.reactions.push({
            userId: user._id,
            emoji,
            createdAt: new Date(),
          });
          await message.save();
        }

        io.to(roomId).emit("chat:reaction:update", {
          messageId: message._id,
          reactions: message.reactions,
        });

        if (typeof callback === "function") callback({ success: true, reactions: message.reactions });
      } catch (err) {
        console.error("Error adding reaction:", err);
      }
    });

    // ── EVENT: chat:reaction:remove ──────────────
    socket.on("chat:reaction:remove", async ({ messageId, emoji }, callback) => {
      try {
        if (!messageId || !emoji) return;

        const message = await LiveChatMessage.findById(messageId);
        if (!message || message.isDeleted) return;

        message.reactions = message.reactions.filter(
          (r) => !(r.userId.toString() === user._id.toString() && r.emoji === emoji)
        );
        await message.save();

        io.to(roomId).emit("chat:reaction:update", {
          messageId: message._id,
          reactions: message.reactions,
        });

        if (typeof callback === "function") callback({ success: true, reactions: message.reactions });
      } catch (err) {
        console.error("Error removing reaction:", err);
      }
    });

    // ── EVENT: chat:read ─────────────────────────
    socket.on("chat:read", async ({ lastReadMessageId }) => {
      try {
        await ChatReadState.findOneAndUpdate(
          { userId: user._id, roomId },
          { lastReadMessageId: lastReadMessageId || null, lastReadAt: new Date() },
          { upsert: true, new: true }
        );

        socket.emit("chat:unread:update", { unreadCount: 0 });
      } catch (err) {
        console.error("Error updating read state:", err);
      }
    });

    // ── EVENT: chat:report ───────────────────────
    socket.on("chat:report", async ({ messageId, reason, details }, callback) => {
      try {
        if (!messageId || !reason) {
          if (typeof callback === "function") callback({ error: "Message ID and reason are required" });
          return;
        }

        const existing = await ChatReport.findOne({
          messageId,
          reportedBy: user._id,
          status: "Pending",
        });

        if (existing) {
          if (typeof callback === "function") callback({ error: "You have already reported this message" });
          return;
        }

        const report = await ChatReport.create({
          messageId,
          reportedBy: user._id,
          reason,
          details: details || "",
        });

        // Notify admins in real-time
        io.to("admin_room").emit("admin:report:new", report);

        if (typeof callback === "function") callback({ success: true, report });
      } catch (err) {
        console.error("Error reporting message:", err);
        if (typeof callback === "function") callback({ error: "Failed to submit report" });
      }
    });

    // Join admin room if user is admin
    if (user.role === "admin") {
      socket.join("admin_room");
    }

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected from Chat Socket: ${user.name}`);
    });
  });
};

const getIO = () => ioInstance;

module.exports = {
  setupChatSocket,
  getIO,
};
