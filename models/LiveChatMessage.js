const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    emoji: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const moderationFlagSchema = new mongoose.Schema(
  {
    flagType: {
      type: String,
      enum: ["spam", "duplicate", "keyword", "rapid_messaging"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const liveChatMessageSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    displayNameSnapshot: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      default: "",
    },
    replyToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveChatMessage",
      default: null,
    },
    linkedOpportunityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Opportunity",
      default: null,
    },
    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    reactions: [reactionSchema],
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deleteReason: {
      type: String,
      default: "",
    },
    moderationStatus: {
      type: String,
      enum: ["clean", "flagged", "removed"],
      default: "clean",
    },
    moderationFlags: [moderationFlagSchema],
    retentionStatus: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
  },
  { timestamps: true }
);

liveChatMessageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model("LiveChatMessage", liveChatMessageSchema);
