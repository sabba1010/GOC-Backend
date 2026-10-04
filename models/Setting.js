const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "subscription_pricing",
    },
    monthlyPrice: {
      type: Number,
      default: 8,
      min: 0,
    },
    yearlyPrice: {
      type: Number,
      default: 12,
      min: 0,
    },
    currency: {
      type: String,
      default: "usd",
      lowercase: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);
