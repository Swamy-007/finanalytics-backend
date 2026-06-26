import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures mockCreate is defined before the vi.mock factory runs
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => {
  class APIConnectionTimeoutError extends Error {
    constructor() {
      super("Connection timed out");
      this.name = "APIConnectionTimeoutError";
    }
  }

  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));

  return { default: OpenAI, APIConnectionTimeoutError };
});

// Import after mocks are registered
import {
  extractTransactionsAI,
  generateInsights,
  generateFinancialAnalysisAI,
  type Transaction,
  type FinancialAnalysisResult,
} from "../services/aiService.js";
import type { UserProfile, FinancialData, Product } from "../services/dbService.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function aiResponse(content: string) {
  return Promise.resolve({ choices: [{ message: { content } }] });
}

function makeTimeoutError() {
  const err = new Error("Connection timed out");
  err.name = "APIConnectionTimeoutError";
  return err;
}

const mockProfile: UserProfile = {
  firstName: "Jane",
  lastName: "Doe",
  address: "123 Main St",
  phone: "555-0100",
  email: "jane@example.com",
  ageRange: "26-35",
  familyMembers: [],
  dependents: [],
};

const mockFinancialData: FinancialData = {
  assets: [{ name: "Savings", type: "savings", value: 20000 }],
  liabilities: [{ name: "Car Loan", type: "loan", value: 5000, monthlyPayment: 300 }],
  primaryYearlyIncome: 80000,
  familyYearlyIncome: 0,
  expenditures: [{ type: "credit_card", description: "Visa", monthlyAmount: 500 }],
  savings: [{ type: "401k", description: "Employer 401k", monthlyContribution: 800 }],
};

const mockProducts: Product[] = [
  {
    id: "p1",
    name: "Basic Savings",
    type: "savings",
    provider: "Bank A",
    description: "High-yield savings",
    benefits: ["2% APY"],
  },
  {
    id: "p2",
    name: "Term Life",
    type: "insurance",
    provider: "Insurer B",
    description: "Term life insurance",
    benefits: ["$500k coverage"],
  },
];

// ── extractTransactionsAI ──────────────────────────────────────────────────

describe("extractTransactionsAI", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("parses a valid JSON array from the AI response", async () => {
    const transactions: Transaction[] = [
      { date: "09/15", description: "KROGER", amount: 45.67, category: "Groceries" },
    ];
    mockCreate.mockReturnValue(aiResponse(JSON.stringify(transactions)));

    const result = await extractTransactionsAI("dummy text");
    expect(result).toEqual(transactions);
  });

  it("strips markdown fences before parsing", async () => {
    const json = '[{"date":"09/15","description":"UBER","amount":12.5,"category":"Transport"}]';
    mockCreate.mockReturnValue(aiResponse("```json\n" + json + "\n```"));

    const result = await extractTransactionsAI("dummy text");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.category).toBe("Transport");
  });

  it("returns [] when AI returns an empty array", async () => {
    mockCreate.mockReturnValue(aiResponse("[]"));

    const result = await extractTransactionsAI("dummy text");
    expect(result).toEqual([]);
  });

  it("returns [] when AI returns a non-array JSON value", async () => {
    mockCreate.mockReturnValue(aiResponse('{"error":"no transactions"}'));

    const result = await extractTransactionsAI("dummy text");
    expect(result).toEqual([]);
  });

  it("returns [] when AI returns malformed JSON", async () => {
    mockCreate.mockReturnValue(aiResponse("not valid json at all"));

    const result = await extractTransactionsAI("dummy text");
    expect(result).toEqual([]);
  });

  it("returns [] on APIConnectionTimeoutError", async () => {
    mockCreate.mockReturnValue(Promise.reject(makeTimeoutError()));

    const result = await extractTransactionsAI("dummy text");
    expect(result).toEqual([]);
  });

  it("returns [] on unexpected error", async () => {
    mockCreate.mockReturnValue(Promise.reject(new Error("network error")));

    const result = await extractTransactionsAI("dummy text");
    expect(result).toEqual([]);
  });
});

// ── generateInsights ───────────────────────────────────────────────────────

describe("generateInsights", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const sampleTransactions: Transaction[] = [
    { date: "09/15", description: "KROGER", amount: 45.67, category: "Groceries" },
    { date: "09/16", description: "STARBUCKS", amount: 6.5, category: "Dining" },
  ];

  it("returns the AI response content directly", async () => {
    const insightText = "### Top Categories\n* Groceries $45.67";
    mockCreate.mockReturnValue(aiResponse(insightText));

    const result = await generateInsights(sampleTransactions);
    expect(result).toBe(insightText);
  });

  it("returns empty string when AI returns null content", async () => {
    mockCreate.mockReturnValue(
      Promise.resolve({ choices: [{ message: { content: null } }] })
    );

    const result = await generateInsights(sampleTransactions);
    expect(result).toBe("");
  });

  it("returns empty string on APIConnectionTimeoutError", async () => {
    mockCreate.mockReturnValue(Promise.reject(makeTimeoutError()));

    const result = await generateInsights(sampleTransactions);
    expect(result).toBe("");
  });

  it("returns empty string on unexpected error", async () => {
    mockCreate.mockReturnValue(Promise.reject(new Error("API down")));

    const result = await generateInsights(sampleTransactions);
    expect(result).toBe("");
  });
});

// ── generateFinancialAnalysisAI ────────────────────────────────────────────

describe("generateFinancialAnalysisAI", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const validResult: FinancialAnalysisResult = {
    score: 78,
    debtRatio: 22,
    savingsRatio: 18,
    gaps: ["Low emergency fund", "No life insurance"],
    advice: "Build an emergency fund of 6 months expenses.",
    productRecommendations: [
      { productId: "p1", reasoning: "High savings rate suits this account." },
    ],
  };

  it("returns parsed values when AI returns a valid JSON object", async () => {
    mockCreate.mockReturnValue(aiResponse(JSON.stringify(validResult)));

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(result.score).toBe(78);
    expect(result.debtRatio).toBe(22);
    expect(result.savingsRatio).toBe(18);
    expect(result.gaps).toEqual(["Low emergency fund", "No life insurance"]);
    expect(result.productRecommendations).toHaveLength(1);
  });

  it("strips markdown fences before parsing", async () => {
    mockCreate.mockReturnValue(
      aiResponse("```json\n" + JSON.stringify(validResult) + "\n```")
    );

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(result.score).toBe(78);
  });

  it("falls back to defaults for missing numeric fields", async () => {
    const partial = { gaps: ["gap1"], advice: "some advice", productRecommendations: [] };
    mockCreate.mockReturnValue(aiResponse(JSON.stringify(partial)));

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(typeof result.score).toBe("number");
    expect(typeof result.debtRatio).toBe("number");
    expect(typeof result.savingsRatio).toBe("number");
  });

  it("falls back to defaults for missing array fields", async () => {
    const partial = { score: 70, debtRatio: 30, savingsRatio: 20, advice: "ok" };
    mockCreate.mockReturnValue(aiResponse(JSON.stringify(partial)));

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(Array.isArray(result.productRecommendations)).toBe(true);
  });

  it("returns fallback with product list on malformed JSON", async () => {
    mockCreate.mockReturnValue(aiResponse("this is not json"));

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(result.score).toBeGreaterThan(0);
    // Fallback populates up to 2 products from the catalog
    expect(result.productRecommendations.length).toBeGreaterThan(0);
    expect(result.productRecommendations[0]!.productId).toBe("p1");
  });

  it("returns fallback on APIConnectionTimeoutError", async () => {
    mockCreate.mockReturnValue(Promise.reject(makeTimeoutError()));

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(result.score).toBeGreaterThan(0);
    expect(typeof result.advice).toBe("string");
  });

  it("returns fallback on unexpected error", async () => {
    mockCreate.mockReturnValue(Promise.reject(new Error("503 Service Unavailable")));

    const result = await generateFinancialAnalysisAI(
      mockProfile,
      mockFinancialData,
      mockProducts
    );
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});
