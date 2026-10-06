const mongoose = require("mongoose");

const resourceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    category: {
      type: String,
      default: "GENERAL",
      trim: true,
    },
    image: {
      type: String,
      default: "",
    },
    pdfFile: {
      type: String,
      default: "",
    },
    pdfOriginalName: {
      type: String,
      default: "",
    },
    externalLink: {
      type: String,
      default: "",
      trim: true,
    },
    deadline: {
      type: Date,
      default: null,
    },
    resourceType: {
      type: String,
      enum: [
        "Scholarship",
        "Internship",
        "Fellowship",
        "Program",
        "Event",
        "Guide",
        "Article",
        "General Resource",
      ],
      default: "General Resource",
    },
    locationType: {
      type: String,
      enum: ["Virtual", "In-person", "Hybrid", "Location-specific"],
      default: "Virtual",
    },
    locationAddress: {
      type: String,
      default: "",
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["Published", "Draft"],
      default: "Published",
    },
  },
  { timestamps: true }
);

resourceSchema.index({ status: 1, createdAt: -1 });
resourceSchema.index({ category: 1 });

module.exports = mongoose.model("Resource", resourceSchema);
