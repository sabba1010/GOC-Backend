const Resource = require("../models/Resource");
const path = require("path");
const fs = require("fs");

// @desc    Create a new resource (Admin only)
// @route   POST /api/resources
// @access  Private/Admin
const createResource = async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      externalLink,
      deadline,
      resourceType,
      locationType,
      locationAddress,
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({ message: "Title and description are required" });
    }

    let imageUrl = "";
    let pdfUrl = "";
    let pdfOriginalName = "";

    // Handle uploaded files
    if (req.files) {
      if (req.files.image && req.files.image[0]) {
        imageUrl = `/uploads/${req.files.image[0].filename}`;
      }
      if (req.files.pdf && req.files.pdf[0]) {
        pdfUrl = `/uploads/${req.files.pdf[0].filename}`;
        pdfOriginalName = req.files.pdf[0].originalname;
      }
    }

    const resource = await Resource.create({
      title,
      description,
      category: category ? category.toUpperCase() : "GENERAL",
      image: imageUrl,
      pdfFile: pdfUrl,
      pdfOriginalName,
      externalLink: externalLink || "",
      deadline: deadline ? new Date(deadline) : null,
      resourceType: resourceType || "General Resource",
      locationType: locationType || "Virtual",
      locationAddress: locationAddress || "",
      uploadedBy: req.user._id,
      status: "Published",
    });

    res.status(201).json({ success: true, resource });
  } catch (error) {
    res.status(500).json({ message: "Failed to create resource", error: error.message });
  }
};

// @desc    Get all published resources
// @route   GET /api/resources
// @access  Public / Private
const getResources = async (req, res) => {
  try {
    const resources = await Resource.find({ status: "Published" })
      .populate("uploadedBy", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: resources.length, resources });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch resources", error: error.message });
  }
};

// @desc    Get all resources (Admin - includes drafts)
// @route   GET /api/resources/admin
// @access  Private/Admin
const getAllResourcesAdmin = async (req, res) => {
  try {
    const resources = await Resource.find()
      .populate("uploadedBy", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: resources.length, resources });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch resources", error: error.message });
  }
};

// @desc    Delete a resource (Admin only)
// @route   DELETE /api/resources/:id
// @access  Private/Admin
const deleteResource = async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: "Resource not found" });
    }

    // Delete associated files
    const deleteFile = (filePath) => {
      if (filePath) {
        const fullPath = path.join(__dirname, "..", filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
    };

    deleteFile(resource.image);
    deleteFile(resource.pdfFile);

    await resource.deleteOne();
    res.status(200).json({ success: true, message: "Resource deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete resource", error: error.message });
  }
};

module.exports = { createResource, getResources, getAllResourcesAdmin, deleteResource };
