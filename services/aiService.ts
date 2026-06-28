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

const MODEL = process.env.AI_MODEL ?? "meta/llama-3.3-70b-instruct";
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes

// Lazy singleton — defer construction until first call so a missing
// NVIDIA_API_KEY does NOT crash the process at startup (Cloud Run startup
// failure was caused by OpenAI SDK throwing synchronously when apiKey is
// undefined at module import time).
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.NVIDIA_API_KEY;
    const baseURL = process.env.AI_BASE_URL;
    if (!apiKey) {
      console.error("[aiService] NVIDIA_API_KEY is not set. AI features will be unavailable.");
      throw new Error("NVIDIA_API_KEY environment variable is not configured.");
    }
    if (!baseURL) {
      console.error("[aiService] AI_BASE_URL is not set. AI features will be unavailable.");
      throw new Error("AI_BASE_URL environment variable is not configured.");
    }
    console.log(`[aiService] Initializing AI client — baseURL=${baseURL} model=${MODEL}`);
    _client = new OpenAI({
      baseURL,
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return _client;
}

async function callAI(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens = 10000,
  label = "callAI"
): Promise<string> {
  console.log(`[${label}] model=${MODEL} max_tokens=${maxTokens} prompt_chars=${JSON.stringify(messages).length}`);
  const start = Date.now();
  const completion = await getClient().chat.completions.create({
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
  const userMessage = `You are a financial assistant. Analyze the following credit card transactions and respond using EXACTLY this markdown structure — use ### headings and * bullet points:

### Top Categories
* Category: $amount (X% of total)
(list all categories with totals)

### Saving Tips
* Actionable tip based on the data

### Unusual Spending & Observations
* Any anomalies or notable patterns

### Recommendations
* Specific next-step advice

Rules:
- Use ### for section headings (no other heading levels)
- Use * for bullet points
- Include dollar amounts where relevant
- Keep each section concise (3-5 bullets)

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
  const totalYearlyIncome = (data.primaryYearlyIncome || 0) + (data.familyYearlyIncome || 0);
  const totalMonthlyExpenditure = (data.expenditures || []).reduce((s, e) => s + e.monthlyAmount, 0);
  const totalMonthlySavings = (data.savings || []).reduce((s, sv) => s + sv.monthlyContribution, 0);
  const annualExpenditure = totalMonthlyExpenditure * 12;
  const annualSavings = totalMonthlySavings * 12;
  const expenditureToIncomeRatio = totalYearlyIncome > 0 ? ((annualExpenditure / totalYearlyIncome) * 100).toFixed(1) : "N/A";
  const savingsRate = totalYearlyIncome > 0 ? ((annualSavings / totalYearlyIncome) * 100).toFixed(1) : "N/A";

  const familySummary = [
    ...(profile.familyMembers || []).map(m => `${m.relationship} (${m.ageRange})`),
    ...(profile.dependents || []).map(d => `${d.relationship} dependent (${d.ageRange})`),
  ].join(", ") || "None declared";

  const userMessage = `You are an expert AI Financial Advisor and Product Matcher. Analyze the user profile and financial data below, then recommend products from the catalog.

## User Profile
- Name: ${profile.firstName} ${profile.lastName}
- Age Range: ${profile.ageRange}
- Family members: ${familySummary}

## Income
- Primary Yearly Income: $${data.primaryYearlyIncome?.toLocaleString() ?? 0}
- Family / Household Yearly Income: $${data.familyYearlyIncome?.toLocaleString() ?? 0}
- Combined Yearly Income: $${totalYearlyIncome.toLocaleString()}

## Monthly Expenditures
${(data.expenditures || []).map(e => `- ${e.type} | ${e.description}: $${e.monthlyAmount}/mo`).join("\n") || "None entered"}
- Total Monthly Expenditure: $${totalMonthlyExpenditure.toLocaleString()}/mo
- Annual Expenditure: $${annualExpenditure.toLocaleString()}
- Expenditure-to-Income Ratio: ${expenditureToIncomeRatio}%

## Monthly Savings
${(data.savings || []).map(s => `- ${s.type} | ${s.description}: $${s.monthlyContribution}/mo`).join("\n") || "None entered"}
- Total Monthly Savings: $${totalMonthlySavings.toLocaleString()}/mo
- Annual Savings: $${annualSavings.toLocaleString()}
- Savings Rate: ${savingsRate}%

## Assets
${JSON.stringify(data.assets, null, 2)}

## Liabilities
${JSON.stringify(data.liabilities, null, 2)}

## Available Products Catalog
${JSON.stringify(products, null, 2)}

## Instructions
1. Calculate a financial health score (0-100) using income, expenditure ratio, savings rate, and debt load.
2. Estimate debt-to-assets ratio as a percentage (0-100).
3. Estimate savings ratio as a percentage (0-100) — use the savings rate above.
4. Identify 3-5 specific gaps. MUST reference actual income vs expenditure numbers (e.g. "Expenditure-to-income ratio of ${expenditureToIncomeRatio}% exceeds the recommended 50% threshold").
5. Give detailed, actionable advice grounded in the income vs expenditure gap and the 50/30/20 rule.
6. Recommend 1-4 products from the catalog. PRIMARY driver for product TYPE must be family composition and age groups (e.g. children → education plan, elderly dependents → long-term care, no dependents → growth investment). SECONDARY driver is income vs expenditure gap (e.g. high expenditure ratio → debt consolidation first).

Return ONLY a valid JSON object (no markdown, no extra text):
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
