const User = require("../models/User");
const LiveChatMessage = require("../models/LiveChatMessage");
const ChatRoom = require("../models/ChatRoom");

// Flagged keywords / link patterns
const SUSPICIOUS_KEYWORDS = [
  "crypto-scam",
  "free-money-now",
  "bit.ly/fake-link",
  "buy-followers",
];

/**
 * Validate whether a user is allowed to post in a chat room.
 */
const validateUserCanPost = async (userId, roomId) => {
  const user = await User.findById(userId);
  if (!user) {
    return { allowed: false, reason: "User not found" };
  }

  const now = new Date();

  // 1. Account suspended
  if (user.status === "Suspended") {
    return { allowed: false, reason: "Your account is suspended." };
  }

  // 2. Chat access revoked
  if (user.chatAccessRevoked) {
    return { allowed: false, reason: "Your chat access has been permanently revoked by an administrator." };
  }

  // 3. Temporarily restricted
  if (user.chatRestrictedUntil && user.chatRestrictedUntil > now) {
    const minutesLeft = Math.ceil((user.chatRestrictedUntil.getTime() - now.getTime()) / 60000);
    return { allowed: false, reason: `You are restricted from chat for ${minutesLeft} more minute(s).` };
  }

  // 4. Temporarily muted
  if (user.chatMutedUntil && user.chatMutedUntil > now) {
    const secondsLeft = Math.ceil((user.chatMutedUntil.getTime() - now.getTime()) / 1000);
    return { allowed: false, reason: `You are muted from sending messages for ${secondsLeft} more second(s).` };
  }

  // 5. Check Room status
  const room = await ChatRoom.findById(roomId);
  if (!room) {
    return { allowed: false, reason: "Chat room not found." };
  }

  if (room.isPaused) {
    return {
      allowed: false,
      reason: room.pauseReason
        ? `Chat is currently paused: ${room.pauseReason}`
        : "Chat room is currently paused by an admin.",
    };
  }

  // 6. Check Slow Mode
  if (room.slowModeEnabled && room.slowModeSeconds > 0) {
    const lastMessage = await LiveChatMessage.findOne({
      roomId: room._id,
      senderId: user._id,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    if (lastMessage) {
      const elapsedSeconds = Math.floor((now.getTime() - new Date(lastMessage.createdAt).getTime()) / 1000);
      if (elapsedSeconds < room.slowModeSeconds) {
        const waitTime = room.slowModeSeconds - elapsedSeconds;
        return {
          allowed: false,
          reason: `Slow mode is active. Please wait ${waitTime} second(s) before sending another message.`,
          remainingSeconds: waitTime,
        };
      }
    }
  }

  return { allowed: true, user, room };
};

/**
 * Check message content for spam or automated flags.
 */
const evaluateMessageSpam = async (userId, roomId, content) => {
  const flags = [];

  if (!content) return { isFlagged: false, flags };

  const now = new Date();

  // 1. Keyword / link check
  const lowerContent = content.toLowerCase();
  for (const kw of SUSPICIOUS_KEYWORDS) {
    if (lowerContent.includes(kw)) {
      flags.push({
        flagType: "keyword",
        reason: `Contained suspicious phrase/link matching: "${kw}"`,
        createdAt: now,
      });
    }
  }

  // 2. Rapid messaging check (more than 4 messages in 8 seconds)
  const eightSecondsAgo = new Date(now.getTime() - 8000);
  const recentMsgCount = await LiveChatMessage.countDocuments({
    roomId,
    senderId: userId,
    createdAt: { $gte: eightSecondsAgo },
  });

  if (recentMsgCount >= 4) {
    flags.push({
      flagType: "rapid_messaging",
      reason: `User sent ${recentMsgCount + 1} messages within 8 seconds`,
      createdAt: now,
    });
  }

  // 3. Repeated duplicate message check
  const lastMessage = await LiveChatMessage.findOne({
    roomId,
    senderId: userId,
  }).sort({ createdAt: -1 });

  if (lastMessage && lastMessage.content.trim() === content.trim()) {
    flags.push({
      flagType: "duplicate",
      reason: "Sent duplicate consecutive message content",
      createdAt: now,
    });
  }

  return {
    isFlagged: flags.length > 0,
    flags,
  };
};

module.exports = {
  validateUserCanPost,
  evaluateMessageSpam,
};
