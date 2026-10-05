const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (e) {
  console.warn("DNS override note:", e.message);
}

require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const connectDB = require("./config/db");

const app = express();

// ── Connect MongoDB ────────────────────────────
connectDB();

// ── Middleware ─────────────────────────────────
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:8080",
      "https://duplicate-web-pal.vercel.app"
    ];
    
    const isVercel = origin.endsWith(".vercel.app");
    
    if (allowedOrigins.includes(origin) || isVercel) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
// ── Stripe Webhook (Raw Body Parser before express.json) ──────
app.post("/api/subscription/webhook", express.raw({ type: "application/json" }), require("./controllers/subscriptionController").handleWebhook);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ── Health Check ───────────────────────────────
app.get("/", (req, res) => {
  res.json({ message: "🎀 GOC API is running!", status: "ok" });
});

const http = require("http");
const { Server } = require("socket.io");
const { setupChatSocket } = require("./socket/chatSocket");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "https://duplicate-web-pal.vercel.app",
      ];
      const isVercel = origin.endsWith(".vercel.app");
      if (allowedOrigins.includes(origin) || isVercel) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  },
});

setupChatSocket(io);

// ── Routes ─────────────────────────────────────
app.use("/api/users", require("./routes/user"));
app.use("/api/opportunities", require("./routes/opportunity"));
app.use("/api/upload", require("./routes/upload"));
app.use("/api/resources", require("./routes/resource"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/admin/chat", require("./routes/adminChat"));
app.use("/api/subscription", require("./routes/subscription"));

// ── Serve Static Files ─────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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
server.listen(PORT, () => {
  console.log(`🚀 Server & Socket.IO running on http://localhost:${PORT}`);
});
