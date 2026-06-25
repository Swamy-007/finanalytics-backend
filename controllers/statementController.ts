import type { Request, Response } from "express";
import { createRequire } from "module";
import { extractTransactionsAI, generateInsights } from "../services/aiService.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export const processStatement = async (req: Request, res: Response) => {
  try {
    console.log("Processing statement upload...");

    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("File received:", file.originalname, `(${(file.size / 1024).toFixed(1)} KB)`);

    const pdfData = await pdfParse(file.buffer) as { text: string };
    const text = pdfData.text;

    if (!text || text.trim().length === 0) {
      return res.status(422).json({
        error: "Could not extract text from PDF. The file may be scanned or image-based.",
      });
    }

    console.log("PDF text extracted, length:", text.length);

    const transactions = await extractTransactionsAI(text);
    const insights = await generateInsights(transactions);

    res.json({ transactions, insights });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("Error processing statement:", message);
    res.status(500).json({ error: message });
  }
};