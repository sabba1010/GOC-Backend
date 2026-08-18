const mongoose = require("mongoose");

const chatReportSchema = new mongoose.Schema(
  {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LiveChatMessage",
      required: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      enum: ["Spam", "Harassment", "Inappropriate Content", "Scam", "Other"],
      required: true,
    },
    details: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Pending", "Reviewed", "Action Taken", "Dismissed"],
      default: "Pending",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    actionTaken: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatReport", chatReportSchema);
