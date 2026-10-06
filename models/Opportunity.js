const mongoose = require("mongoose");

const opportunitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    organization: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      required: [true, "Category is required"],
    },
    deadline: {
      type: String,
      required: [true, "Deadline is required"],
    },
    tags: {
      type: [String],
      default: [],
    },
    image: {
      type: String,
      required: [true, "Image URL is required"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
    },
    pdfFile: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["Published", "Draft", "Archived"],
      default: "Published",
    },
  },
  { timestamps: true }
);

opportunitySchema.index({ status: 1, createdAt: -1 });
opportunitySchema.index({ category: 1 });

module.exports = mongoose.model("Opportunity", opportunitySchema);
