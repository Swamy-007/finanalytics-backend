
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.js";

import OpenAI from "openai";

let openai: OpenAI | undefined;

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001;

console.log("App initialized with PORT", PORT);
// Health endpoint
app.get("/env", (req, res) => {
  res.json({
    status: "Backend Running",
    env: process.env.ENVIRONMENT,
  });
});


console.log("App initialized with PORT_FRONTEND:", process.env.PORT_FRONTEND);
//console.log("Gemini initialized with GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "****" + process.env.GEMINI_API_KEY.slice(-4) : "Not Set");

app.use(cors());
app.use(express.json());

app.use("/api", uploadRoutes);

//console.log("Initializing openai Service...*****" +
   //openai + " PORT: **** " + process.env.PORT + " KEY: " + (process.env.OPENAI_API_KEY ? "****" + process.env.OPENAI_API_KEY.slice(-4) : "Not Set"));


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});       