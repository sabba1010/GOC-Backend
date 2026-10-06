const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
    },
    role: {
      type: String,
      enum: ["student", "mentor", "admin"],
      default: "student",
    },
    avatar: {
      type: String,
      default: "",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    bio: {
      type: String,
      default: "",
    },
    school: {
      type: String,
      default: "",
    },
    certificates: [
      {
        title: { type: String },
        url: { type: String },
      },
    ],
    customFields: [
      {
        label: { type: String },
        value: { type: String },
      },
    ],
    status: {
      type: String,
      enum: ["Active", "Suspended"],
      default: "Active",
    },
    savedOpportunities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Opportunity",
      },
    ],
    appliedOpportunities: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Opportunity",
      },
    ],
    applications: [
      {
        opportunity: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Opportunity",
        },
        status: {
          type: String,
          enum: ["Pending", "Approved", "Rejected"],
          default: "Pending",
        },
        note: {
          type: String,
          default: "",
        },
        appliedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    reminders: [
      {
        title: { type: String, required: true },
        date: { type: Date, required: true },
        opportunityId: { type: mongoose.Schema.Types.ObjectId, ref: "Opportunity" },
        type: {
          type: String,
          enum: ["opportunity_deadline", "application_deadline", "saved_deadline", "personal_reminder", "application_status"],
          default: "personal_reminder",
        },
        notes: { type: String, default: "" },
        isCompleted: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    chatMutedUntil: {
      type: Date,
      default: null,
    },
    chatRestrictedUntil: {
      type: Date,
      default: null,
    },
    chatAccessRevoked: {
      type: Boolean,
      default: false,
    },
    chatMuteNotificationsUntil: {
      type: Date,
      default: null,
    },
    // Stripe Subscription Fields
    stripeCustomerId: {
      type: String,
      default: "",
    },
    stripeSubscriptionId: {
      type: String,
      default: "",
    },
    subscriptionPlan: {
      type: String,
      enum: ["monthly", "yearly", "none"],
      default: "none",
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete", "inactive"],
      default: "inactive",
    },
    currentPeriodStart: {
      type: Date,
      default: null,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, status: 1 });

// Method to check if user has active resource dashboard access
userSchema.methods.hasResourceAccess = function () {
  if (this.role === "admin" || this.role === "mentor") return true;
  if (this.subscriptionStatus === "active" || this.subscriptionStatus === "trialing") return true;
  if (this.currentPeriodEnd && new Date(this.currentPeriodEnd) > new Date()) return true;
  return false;
};

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
