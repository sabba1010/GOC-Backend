const mongoose = require("mongoose");

const chatModerationActionSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveChatMessage",
      default: null,
    },
    action: {
      type: String,
      enum: ["Warn", "Mute", "Restrict", "Remove Chat Access", "Restore Access", "Remove Message", "Restore Message"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    previousState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatModerationAction", chatModerationActionSchema);
