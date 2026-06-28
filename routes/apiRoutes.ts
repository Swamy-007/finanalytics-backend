import express from "express";
import type { Request, Response } from "express";
import { verifyAnyToken } from "../authmiddleware.js";
import type { AuthenticatedRequest } from "../authmiddleware.js";
import {
  getUserData,
  updateUserData,
  readDB
} from "../services/dbService.js";
import type {
  UserProfile,
  FinancialData,
  Case
} from "../services/dbService.js";
import { generateFinancialAnalysisAI } from "../services/aiService.js";
import { registerUser, loginUser } from "../services/userService.js";
import {
  upsertUserLogin,
  saveFinancialDataToSheet,
  loadFinancialDataFromSheet,
} from "../services/googleSheetsService.js";
import { authLog } from "../utils/authLogger.js";
import { issueSessionToken } from "../utils/sessionToken.js";

const router = express.Router();

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

function clientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// POST /users/register — public, no auth required
router.post("/users/register", async (req: Request, res: Response) => {
  const { name, email, password } = req.body as {
    name?: string;
    email?: string;
    password?: string;
  };

  const ip = clientIp(req);
  authLog({ event: "REGISTER_ATTEMPT", email: email?.trim(), ip });

  if (!name?.trim() || !email?.trim() || !password) {
    authLog({ event: "REGISTER_FAILED", email: email?.trim(), ip, reason: "Missing required fields" });
    res.status(400).json({ error: "Name, email, and password are required." });
    return;
  }
  if (password.length < 6) {
    authLog({ event: "REGISTER_FAILED", email: email.trim(), ip, reason: "Password too short" });
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  try {
    const user = await registerUser(name, email, password);
    authLog({ event: "REGISTER_SUCCESS", email: user.email, name: user.name, ip });
    res.status(201).json({
      id:           user.id,
      name:         user.name,
      email:        user.email,
      createdAt:    user.createdAt,
      sessionToken: issueSessionToken(user.id, user.email, user.name),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Registration failed.";
    const status = msg === "Email already registered" ? 409 : 500;
    authLog({ event: "REGISTER_FAILED", email: email?.trim(), ip, reason: msg });
    res.status(status).json({ error: msg });
  }
});

// POST /users/login — public, email+password sign-in, reads from users.xlsx
router.post("/users/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  const ip = clientIp(req);
  authLog({ event: "LOGIN_ATTEMPT", email: email?.trim(), ip });

  if (!email?.trim() || !password) {
    authLog({ event: "LOGIN_FAILED", email: email?.trim(), ip, reason: "Missing email or password" });
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  try {
    const user = await loginUser(email, password);
    authLog({ event: "LOGIN_SUCCESS", email: user.email, name: user.name, ip });
    res.json({
      id:           user.id,
      name:         user.name,
      email:        user.email,
      createdAt:    user.createdAt,
      sessionToken: issueSessionToken(user.id, user.email, user.name),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed.";
    authLog({ event: "LOGIN_FAILED", email: email?.trim(), ip, reason: msg });
    res.status(401).json({ error: msg });
  }
});

// POST /auth/sync — called by frontend on every login (Google OAuth or email/password)
// Records the login in Google Sheets for audit and data-persistence purposes.
router.post("/auth/sync", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, email, name } = req.user!;
    // Email/password session tokens carry a UUID id (36 chars).
    // Google OAuth tokens carry a numeric sub (~21 chars).
    const loginMethod = id.length < 30 ? "google" : "email";
    await upsertUserLogin({ uniqueId: id, email, name, loginMethod });
    res.json({ ok: true, isAdmin: isAdmin(email) });
  } catch (err: any) {
    // Never block the user — sheets sync failure is non-fatal
    console.error("[auth/sync] error:", err.message);
    res.json({ ok: false, isAdmin: false, warning: "Sheets sync failed but login is valid." });
  }
});

// Get User Profile
router.get("/users/profile", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ error: "Unauthorized: No email found in token" });
    }
    const data = await getUserData(email);
    res.json(data.profile || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update User Profile
router.put("/users/profile", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, email } = req.user!;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { firstName, lastName, address, phone, ageRange, familyMembers, dependents } = req.body;

    const profile: UserProfile = {
      firstName: firstName || "",
      lastName: lastName || "",
      address: address || "",
      phone: phone || "",
      email,
      ageRange: ageRange || "",
      familyMembers: familyMembers || [],
      dependents: dependents || [],
    };

    const updated = await updateUserData(email, { profile });

    // Persist profile to Google Sheets (fire-and-forget — non-fatal)
    saveFinancialDataToSheet({ uniqueId: id, email, profile }).catch(err =>
      console.error("[apiRoutes] profile sheets sync failed:", err.message)
    );

    res.json(updated.profile);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Financial Data — tries Google Sheets first, falls back to db.json
router.get("/financial-data", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    // Primary: Google Sheets
    const sheetsData = await loadFinancialDataFromSheet(email);
    if (sheetsData?.financialData) {
      console.log(`[financial-data GET] serving from Google Sheets for ${email}`);
      res.json(sheetsData.financialData);
      return;
    }

    // Fallback: db.json
    const data = await getUserData(email);
    res.json(data.financialData || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save/Update Financial Data — writes to db.json AND Google Sheets
router.post("/financial-data", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, email } = req.user!;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { assets, liabilities, primaryYearlyIncome, familyYearlyIncome, expenditures, savings } = req.body;

    const financialData: FinancialData = {
      assets: assets || [],
      liabilities: liabilities || [],
      primaryYearlyIncome: Number(primaryYearlyIncome) || 0,
      familyYearlyIncome: Number(familyYearlyIncome) || 0,
      expenditures: Array.isArray(expenditures) ? expenditures : [],
      savings: Array.isArray(savings) ? savings : [],
    };

    const updated = await updateUserData(email, { financialData });

    // Mirror to Google Sheets (fire-and-forget — non-fatal)
    saveFinancialDataToSheet({ uniqueId: id, email, financialData }).catch(err =>
      console.error("[apiRoutes] financial-data sheets sync failed:", err.message)
    );

    res.json(updated.financialData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run AI Financial Analysis and Generate Product Matches
router.get("/analysis", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userData = await getUserData(email);

    // Prefer Sheets data when configured (same source as GET /financial-data)
    const sheetsData = await loadFinancialDataFromSheet(email);
    const profile       = (sheetsData?.profile       as UserProfile | undefined) ?? userData.profile;
    const financialData = (sheetsData?.financialData as FinancialData | undefined) ?? userData.financialData;

    if (!profile) {
      return res.status(400).json({ error: "Please complete your User Profile first before running AI analysis." });
    }
    if (!financialData) {
      return res.status(400).json({ error: "Please complete your Financial Profile first before running AI analysis." });
    }

    const db = await readDB();
    const products = db.products;

    console.log(`Running AI financial analysis for ${email}...`);
    const analysisResult = await generateFinancialAnalysisAI(
      profile,
      financialData,
      products
    );

    // Update case management
    const existingCases = userData.cases || [];
    const newCases: Case[] = [...existingCases];

    for (const rec of analysisResult.productRecommendations) {
      // Check if product exists in catalog
      const productExists = products.some(p => p.id === rec.productId);
      if (!productExists) continue;

      // Check if a case already exists for this product
      const caseExists = existingCases.find(c => c.productId === rec.productId);
      if (!caseExists) {
        // Create new case with Recommended status
        newCases.push({
          id: `case_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          productId: rec.productId,
          status: "Recommended",
          reasoning: rec.reasoning,
          applicationDetails: null,
          updatedAt: new Date().toISOString()
        });
      } else {
        // Update reasoning but preserve status if user already accepted/declined/applied
        caseExists.reasoning = rec.reasoning;
        caseExists.updatedAt = new Date().toISOString();
      }
    }

    const aiAnalysis = {
      score: analysisResult.score,
      debtRatio: analysisResult.debtRatio,
      savingsRatio: analysisResult.savingsRatio,
      gaps: analysisResult.gaps,
      advice: analysisResult.advice,
      updatedAt: new Date().toISOString()
    };

    const updated = await updateUserData(email, {
      aiAnalysis,
      cases: newCases
    });

    res.json(updated);
  } catch (err: any) {
    console.error("Analysis route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get User Cases
router.get("/cases", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const data = await getUserData(email);
    
    // Enrich cases with product information
    const db = await readDB();
    const enrichedCases = (data.cases || []).map(c => {
      const product = db.products.find(p => p.id === c.productId);
      return {
        ...c,
        product
      };
    });

    res.json(enrichedCases);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Case Status (Recommended -> Accepted / Declined)
router.put("/cases/:caseId/status", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { caseId } = req.params;
    const { status } = req.body; // Accepted, Declined

    if (!["Accepted", "Declined", "Recommended", "Applied"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const data = await getUserData(email);
    const cases = data.cases || [];
    const targetCase = cases.find(c => c.id === caseId);

    if (!targetCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    targetCase.status = status;
    targetCase.updatedAt = new Date().toISOString();

    await updateUserData(email, { cases });
    res.json(targetCase);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit Application (Apply for a product)
router.post("/applications", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { caseId, applicationDetails } = req.body;

    const data = await getUserData(email);
    const cases = data.cases || [];
    const targetCase = cases.find(c => c.id === caseId);

    if (!targetCase) {
      return res.status(404).json({ error: "Case not found for application" });
    }

    // Capture details and update case to "Applied"
    targetCase.status = "Applied";
    targetCase.applicationDetails = {
      ...applicationDetails,
      submittedAt: new Date().toISOString(),
      referenceNumber: `APP-${Math.floor(100000 + Math.random() * 900000)}`
    };
    targetCase.updatedAt = new Date().toISOString();

    await updateUserData(email, { cases });
    res.json(targetCase);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoints
router.get("/admin/users", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    if (!isAdmin(email)) return res.status(403).json({ error: "Forbidden: Admin access required" });

    const db = await readDB();
    const userSummary = Object.keys(db.users).map(emailKey => {
      const u = db.users[emailKey];
      if (!u) {
        return {
          email: emailKey,
          name: "Unnamed User",
          casesCount: 0,
          hasFinancialData: false,
          healthScore: null
        };
      }
      return {
        email: emailKey,
        name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : "Unnamed User",
        casesCount: (u.cases || []).length,
        hasFinancialData: !!u.financialData,
        healthScore: u.aiAnalysis?.score || null
      };
    });
    
    res.json(userSummary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/admin/analytics", verifyAnyToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAdmin(req.user?.email)) return res.status(403).json({ error: "Forbidden: Admin access required" });

    const db = await readDB();
    
    let totalUsers = Object.keys(db.users).length;
    let casesByStatus = {
      Recommended: 0,
      Accepted: 0,
      Declined: 0,
      Applied: 0
    };
    
    let scoreSum = 0;
    let scoreCount = 0;
    
    for (const u of Object.values(db.users)) {
      if (u.cases) {
        for (const c of u.cases) {
          if (c.status in casesByStatus) {
            casesByStatus[c.status]++;
          }
        }
      }
      if (u.aiAnalysis && typeof u.aiAnalysis.score === "number") {
        scoreSum += u.aiAnalysis.score;
        scoreCount++;
      }
    }
    
    res.json({
      totalUsers,
      casesByStatus,
      averageScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
      totalProducts: db.products.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
