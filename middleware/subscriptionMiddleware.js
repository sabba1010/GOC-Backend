// Middleware to enforce active subscription access for protected resources
const requireSubscription = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }

  // Admins and Mentors or users with an active/paid subscription period get access
  if (req.user.hasResourceAccess && req.user.hasResourceAccess()) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Active subscription required to access the Resources Dashboard.",
    requiresSubscription: true,
  });
};

module.exports = { requireSubscription };
