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
    status: {
      type: String,
      enum: ["Published", "Draft", "Archived"],
      default: "Published",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Opportunity", opportunitySchema);
