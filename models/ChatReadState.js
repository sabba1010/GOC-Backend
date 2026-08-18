const mongoose = require("mongoose");

const chatReadStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatRoom",
      required: true,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveChatMessage",
      default: null,
    },
    lastReadAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

chatReadStateSchema.index({ userId: 1, roomId: 1 }, { unique: true });

module.exports = mongoose.model("ChatReadState", chatReadStateSchema);
