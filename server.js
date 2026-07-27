require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const connectDB = require("./config/db");

const app = express();

// ── Connect MongoDB ────────────────────────────
connectDB();

// ── Middleware ─────────────────────────────────
app.use(cors({
  origin: ["http://localhost:5173", "http://localhost:3000"],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health Check ───────────────────────────────
app.get("/", (req, res) => {
  res.json({ message: "🎀 GOC API is running!", status: "ok" });
});

// ── Routes ─────────────────────────────────────
app.use("/api/users",        require("./routes/user"));
// Future routes:
// app.use("/api/opportunities", require("./routes/opportunity"));
// app.use("/api/mentors",       require("./routes/mentor"));
// app.use("/api/applications",  require("./routes/application"));
// app.use("/api/resources",     require("./routes/resource"));

// ── 404 Handler ────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// ── Global Error Handler ───────────────────────
app.use((err, req, res, next) => {
  console.error("Global error:", err.stack);
  res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
});

// ── Start Server ───────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
