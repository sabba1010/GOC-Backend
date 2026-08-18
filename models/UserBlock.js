const mongoose = require("mongoose");

const userBlockSchema = new mongoose.Schema(
  {
    blockerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    blockedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

userBlockSchema.index({ blockerId: 1, blockedUserId: 1 }, { unique: true });

module.exports = mongoose.model("UserBlock", userBlockSchema);
