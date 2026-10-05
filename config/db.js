const mongoose = require("mongoose");
const dns = require("dns");

// Set reliable public DNS servers to bypass Windows/local router DNS SRV blocks
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (e) {
  console.warn("DNS override note:", e.message);
}

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      family: 4,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
