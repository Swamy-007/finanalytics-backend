import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.js";

import verifyGoogleToken from "./authmiddleware.js";  

const app = express();
app.use(express.json());

app.use(cors({
  origin: ["https://finanalytics-frontend-1000076376022.northamerica-northeast2.run.app",
    "https://finanalytics-frontend-app1-1000076376022.northamerica-northeast2.run.app",
    "http://localhost:5173"],

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});