const mongoose = require("mongoose");

const chatRoomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "Global Chat",
      trim: true,
    },
    type: {
      type: String,
      enum: ["global"],
      default: "global",
    },
    slowModeEnabled: {
      type: Boolean,
      default: false,
    },
    slowModeSeconds: {
      type: Number,
      default: 0,
    },
    isPaused: {
      type: Boolean,
      default: false,
    },
    pauseReason: {
      type: String,
      default: "",
    },
    pausedAt: {
      type: Date,
      default: null,
    },
    pausedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pinnedMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveChatMessage",
      default: null,
    },
    pinnedAt: {
      type: Date,
      default: null,
    },
    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatRoom", chatRoomSchema);
