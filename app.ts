import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.js";
import apiRoutes from "./routes/apiRoutes.js";

import verifyGoogleToken from "./authmiddleware.js";  

const app = express();
app.use(express.json());

const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

if (corsOrigins.length === 0) {
  console.error("[CORS] CORS_ORIGINS env var is missing or blank — no origins are allowed.");
}

app.use(cors({
  origin: corsOrigins,
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001;

console.log("App initialized with PORT", PORT);
// Health endpoint
app.get("/env",verifyGoogleToken, async (req, res) => {
  console.log("Received request to /env endpoint");
  res.json({
    status: "Backend Running",
    env: process.env.ENVIRONMENT,
  });
});

app.post("/health",verifyGoogleToken, async (req, res) => {
  console.log("Received POST request to /health endpoint");
  res.json({
    status: "POST request received",
    env: process.env.ENVIRONMENT,
  });
});

console.log("App initialized with PORT_FRONTEND:", process.env.PORT_FRONTEND);

app.use("/api", uploadRoutes);
app.use("/api", apiRoutes);

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Give sockets 130 s — just over the 120 s AI timeout so the SDK always
// fires first and sends a proper error JSON, not a dropped connection.
server.setTimeout(130_000);