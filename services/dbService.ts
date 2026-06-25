import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "../db.json");

export interface FamilyMember {
  name: string;
  relationship: string; // spouse, child, etc.
  ageRange: string;
}

export interface Dependent {
  name: string;
  relationship: string; // mother, father, etc.
  ageRange: string;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  address: string;
  phone: string;
  email: string;
  ageRange: string;
  familyMembers: FamilyMember[];
  dependents: Dependent[];
}

export interface Asset {
  name: string;
  type: string; // savings, investment, property, cash, other
  value: number;
}

export interface Liability {
  name: string;
  type: string; // loan, mortgage, credit_card, debt, other
  value: number;
  monthlyPayment: number;
}

export interface FinancialData {
  assets: Asset[];
  liabilities: Liability[];
  monthlyCreditCardBills: number;
  monthlySavings: number;
  insuranceExpenses: number;
  otherRecurringCommitments: number;
}

export interface Case {
  id: string;
  productId: string;
  status: "Recommended" | "Accepted" | "Declined" | "Applied";
  reasoning: string;
  applicationDetails: any | null;
  updatedAt: string;
}

export interface UserData {
  profile?: UserProfile;
  financialData?: FinancialData;
  cases: Case[];
  aiAnalysis?: {
    score: number;
    debtRatio: number;
    savingsRatio: number;
    gaps: string[];
    advice: string;
    updatedAt: string;
  };
}

export interface Product {
  id: string;
  name: string;
  type: "loan" | "insurance" | "investment" | "savings";
  provider: string;
  description: string;
  benefits: string[];
}

export interface DatabaseSchema {
  users: Record<string, UserData>;
  products: Product[];
}

const DEFAULT_PRODUCTS: Product[] = [
  {
    id: "prod_high_yield_savings",
    name: "Apex High Yield Savings",
    type: "savings",
    provider: "Apex Bank",
    description: "5.2% APY savings account with no monthly maintenance fees to maximize your return on cash.",
    benefits: ["5.2% Annual Percentage Yield", "No monthly fees", "FDIC Insured up to $250k"]
  },
  {
    id: "prod_premium_health_insurance",
    name: "Shield Pro Premium Family Health",
    type: "insurance",
    provider: "Shield Insurance",
    description: "Low-deductible comprehensive family health plan covering spouse, children, and eligible dependents.",
    benefits: ["$500 individual deductible", "Full spouse & dependent coverage", "Dental, Vision, and Prescription benefits included"]
  },
  {
    id: "prod_debt_consolidation_loan",
    name: "Pathfinder Debt Consolidation Loan",
    type: "loan",
    provider: "Pathfinder Finance",
    description: "Consolidate your high-interest credit card debt into a single low monthly payment.",
    benefits: ["6.9% Fixed APR for qualified borrowers", "No prepayment penalties", "Flexible terms from 24 to 60 months"]
  },
  {
    id: "prod_growth_index_fund",
    name: "Vanguard Growth Index Portfolio",
    type: "investment",
    provider: "Vanguard",
    description: "Low-cost index fund tracking large-cap growth stocks, optimized for long-term wealth accumulation.",
    benefits: ["Industry-low 0.04% expense ratio", "Broad diversification across tech & growth leaders", "Historical average annual return of 10.2%"]
  },
  {
    id: "prod_critical_illness_insurance",
    name: "LifeGuard Critical Illness Rider",
    type: "insurance",
    provider: "LifeGuard Assurance",
    description: "Provides a lump sum cash payment upon diagnosis of major illnesses, helping secure your family's future.",
    benefits: ["Lump-sum payouts up to $100,000", "Covers cancer, heart attack, stroke, etc.", "Flexible premiums based on age"]
  }
];

export async function readDB(): Promise<DatabaseSchema> {
  try {
    const data = await fs.readFile(DB_PATH, "utf-8");
    const parsed = JSON.parse(data);
    
    // Ensure structure is correct
    if (!parsed.users) parsed.users = {};
    if (!parsed.products || parsed.products.length === 0) {
      parsed.products = DEFAULT_PRODUCTS;
    }
    return parsed;
  } catch (err) {
    // If file doesn't exist, create it with default structure
    const initialDB: DatabaseSchema = {
      users: {},
      products: DEFAULT_PRODUCTS
    };
    await writeDB(initialDB);
    return initialDB;
  }
}

export async function writeDB(db: DatabaseSchema): Promise<void> {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

export async function getUserData(email: string): Promise<UserData> {
  const db = await readDB();
  if (!db.users[email]) {
    db.users[email] = {
      cases: []
    };
    await writeDB(db);
  }
  return db.users[email];
}

export async function updateUserData(email: string, updates: Partial<UserData>): Promise<UserData> {
  const db = await readDB();
  if (!db.users[email]) {
    db.users[email] = { cases: [] };
  }
  
  db.users[email] = {
    ...db.users[email],
    ...updates
  };
  
  await writeDB(db);
  return db.users[email];
}
