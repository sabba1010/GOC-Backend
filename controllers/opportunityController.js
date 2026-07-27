const Opportunity = require("../models/Opportunity");

// ──────────────────────────────────────────────
// @route   POST /api/opportunities
// @desc    Create a new opportunity
// @access  Private/Admin
// ──────────────────────────────────────────────
const createOpportunity = async (req, res) => {
  try {
    const opp = await Opportunity.create(req.body);
    res.status(201).json({ success: true, opportunity: opp });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   GET /api/opportunities
// @desc    Get all opportunities
// @access  Public
// ──────────────────────────────────────────────
const getAllOpportunities = async (req, res) => {
  try {
    const opps = await Opportunity.find({}).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: opps.length, opportunities: opps });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   PUT /api/opportunities/:id
// @desc    Update an opportunity
// @access  Private/Admin
// ──────────────────────────────────────────────
const updateOpportunity = async (req, res) => {
  try {
    const opp = await Opportunity.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!opp) return res.status(404).json({ message: "Opportunity not found" });
    res.status(200).json({ success: true, opportunity: opp });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ──────────────────────────────────────────────
// @route   DELETE /api/opportunities/:id
// @desc    Delete an opportunity
// @access  Private/Admin
// ──────────────────────────────────────────────
const deleteOpportunity = async (req, res) => {
  try {
    const opp = await Opportunity.findByIdAndDelete(req.params.id);
    if (!opp) return res.status(404).json({ message: "Opportunity not found" });
    res.status(200).json({ success: true, message: "Opportunity deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  createOpportunity,
  getAllOpportunities,
  updateOpportunity,
  deleteOpportunity,
};
