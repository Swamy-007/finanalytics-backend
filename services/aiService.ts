import "dotenv/config";
import OpenAI, { APIConnectionTimeoutError } from "openai";
import type { UserProfile, FinancialData, Product } from "./dbService.js";

export type Transaction = {
  date: string;
  description: string;
  amount: number;
  category: string;
};

export type FinancialAnalysisResult = {
  score: number;
  debtRatio: number;
  savingsRatio: number;
  gaps: string[];
  advice: string;
  productRecommendations: { productId: string; reasoning: string }[];
};

//const MODEL = "google/gemma-4-31b-it";
const MODEL="meta/llama-3.3-70b-instruct";
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
  timeout: REQUEST_TIMEOUT_MS,
  maxRetries: 0, // no retry — timeout once at 2 min, not 4 min
});

async function callAI(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 10000,
  label = "callAI"
): Promise<string> {
  console.log(`[${label}] model=${MODEL} max_tokens=${maxTokens} prompt_chars=${JSON.stringify(messages).length}`);
  const start = Date.now();
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.7,
    top_p: 0.95,
    max_tokens: maxTokens,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  const content = completion.choices[0]?.message?.content ?? "";
  const usage = completion.usage;
  console.log(`[${label}] response_time=${elapsed}s prompt_tokens=${usage?.prompt_tokens ?? "?"} completion_tokens=${usage?.completion_tokens ?? "?"} total_tokens=${usage?.total_tokens ?? "?"}`);
  console.log(`[${label}] response_preview=${content.slice(0, 300)}${content.length > 300 ? "…" : ""}`);
  return content;
}

function cleanJSON(raw: string): string {
  return raw.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export const extractTransactionsAI = async (
  text: string
): Promise<Transaction[]> => {
  const userMessage = `Extract credit card transactions from the text below.
Rules:
- Apply categories based on description (e.g. KROGER → Groceries, UBER → Transport, NETFLIX → Subscriptions)
- Skip personal info (name, account number, card number)
- Skip invalid or unparseable lines
- Return ONLY a valid JSON array. Each element: { "date": string, "description": string, "amount": number, "category": string }
- If no transactions found, return []

Text:
${text}`;

  try {
    const raw = await callAI([{ role: "user", content: userMessage }], 4096, "extractTransactionsAI");
    const cleaned = cleanJSON(raw);
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      console.warn("[aiService] extractTransactionsAI: response was not an array, returning []");
      return [];
    }
    return parsed as Transaction[];
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) {
      console.error(
        `[aiService] extractTransactionsAI: timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
    } else {
      console.error("[aiService] extractTransactionsAI: failed", error);
    }
    return [];
  }
};

export const generateInsights = async (
  transactions: Transaction[]
): Promise<string> => {
  const userMessage = `You are a financial assistant. Analyze the following credit card transactions and provide:
- Top spending categories (with amounts)
- Saving tips
- Unusual spending observations
- Prediction of next month's spending based on current trends

Transactions:
${JSON.stringify(transactions)}`;

  try {
    const content = await callAI([{ role: "user", content: userMessage }], 4096, "generateInsights");
    return content;
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) {
      console.error(
        `[aiService] generateInsights: timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
    } else {
      console.error("[aiService] generateInsights: failed", error);
    }
    return "";
  }
};

const ANALYSIS_FALLBACK: FinancialAnalysisResult = {
  score: 65,
  debtRatio: 25,
  savingsRatio: 15,
  gaps: [
    "Could not complete AI analysis. Ensure assets and liabilities are saved.",
  ],
  advice:
    "Consider talking to a financial planner. Focus on building an emergency fund covering 3-6 months of expenses, managing monthly commitments, and purchasing adequate family insurance coverage.",
  productRecommendations: [],
};

export const generateFinancialAnalysisAI = async (
  profile: UserProfile,
  data: FinancialData,
  products: Product[]
): Promise<FinancialAnalysisResult> => {
  const userMessage = `You are an expert AI Financial Advisor and Product Matcher. Analyze the following user profile and financial data, and match them with the available products catalog.

User Profile:
${JSON.stringify(profile, null, 2)}

Financial Data:
${JSON.stringify(data, null, 2)}

Available Products Catalog:
${JSON.stringify(products, null, 2)}

Based on this information:
1. Calculate a financial health score (0-100).
2. Estimate the debt-to-assets ratio as a percentage (0-100).
3. Estimate the savings ratio as a percentage (0-100).
4. Identify 3-5 specific gaps in their financial health.
5. Provide detailed actionable personalized advice.
6. Recommend 1-4 products from the catalog with specific reasoning.

Return ONLY a valid JSON object matching this structure (no markdown, no extra text):
{
  "score": number,
  "debtRatio": number,
  "savingsRatio": number,
  "gaps": string[],
  "advice": string,
  "productRecommendations": [{ "productId": string, "reasoning": string }]
}`;

  try {
    const raw = await callAI([{ role: "user", content: userMessage }], 4096, "generateFinancialAnalysisAI");
    const cleaned = cleanJSON(raw);
    const result = JSON.parse(cleaned) as Partial<FinancialAnalysisResult>;
    return {
      score:
        typeof result.score === "number" ? result.score : ANALYSIS_FALLBACK.score,
      debtRatio:
        typeof result.debtRatio === "number"
          ? result.debtRatio
          : ANALYSIS_FALLBACK.debtRatio,
      savingsRatio:
        typeof result.savingsRatio === "number"
          ? result.savingsRatio
          : ANALYSIS_FALLBACK.savingsRatio,
      gaps: Array.isArray(result.gaps) ? result.gaps : ANALYSIS_FALLBACK.gaps,
      advice:
        typeof result.advice === "string"
          ? result.advice
          : ANALYSIS_FALLBACK.advice,
      productRecommendations: Array.isArray(result.productRecommendations)
        ? result.productRecommendations
        : ANALYSIS_FALLBACK.productRecommendations,
    };
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) {
      console.error(
        `[aiService] generateFinancialAnalysisAI: timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
    } else {
      console.error("[aiService] generateFinancialAnalysisAI: failed", error);
    }
    return {
      ...ANALYSIS_FALLBACK,
      productRecommendations: products.slice(0, 2).map((p) => ({
        productId: p.id,
        reasoning: `Recommended based on standard financial planning for ${p.type} products.`,
      })),
    };
  }
};
