/**
 * Google Sheets POC storage layer.
 *
 * Two sheets inside one Google Spreadsheet:
 *   "Users"         — login / session tracking (one row per email)
 *   "FinancialData" — user profile + financial data as JSON (one row per email)
 *
 * Required env vars (all must be set for sheets to be active):
 *   GOOGLE_SHEETS_SPREADSHEET_ID  — the part after /d/ in the sheet URL
 *   GOOGLE_SHEETS_CLIENT_EMAIL    — service-account email (from credentials JSON)
 *   GOOGLE_SHEETS_PRIVATE_KEY     — RSA private key (newlines as \n in .env)
 *
 * If any var is missing, every function silently no-ops (graceful degradation).
 *
 * Sheet header rows (create these once in the spreadsheet):
 *   Users:         UniqueId | Email | Name | LoginMethod | FirstSeen | LastSeen
 *   FinancialData: UniqueId | Email | PrimaryYearlyIncome | FamilyYearlyIncome |
 *                  TotalMonthlyExpenditure | TotalMonthlySavings |
 *                  ProfileJSON | FinancialDataJSON | UpdatedAt
 */
import { GoogleAuth } from "google-auth-library";
import axios from "axios";

const SPREADSHEET_ID  = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const CLIENT_EMAIL    = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;

// Normalise the private key regardless of how it was stored in Cloud Run:
//   1. literal \n  (from .env files and Cloud Run UI copy-paste)
//   2. CRLF line endings (Windows editors)
//   3. Accidental surrounding quotes left from the .env value
const PRIVATE_KEY = (() => {
  const raw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!raw) return undefined;

  let key = raw;

  // Strip surrounding single or double quotes (sometimes pasted from .env accidentally)
  if (/^['"][\s\S]*['"]$/.test(key)) {
    key = key.slice(1, -1);
  }

  // Expand literal \n → real newlines, then normalise CRLF → LF
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");

  // Startup diagnostic — no key material logged, just shape info
  const firstLine = key.split("\n")[0] ?? "";
  console.log(
    `[googleSheetsService] PRIVATE_KEY shape: length=${key.length}` +
    ` startsWithBegin=${firstLine.startsWith("-----BEGIN")}` +
    ` hasNewlines=${key.includes("\n")}`
  );

  return key;
})();

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const SHEET_USERS     = "Users";
const SHEET_FINANCIAL = "FinancialData";

// ── Column indices (0-based) ──────────────────────────────────────────────────
const U = { ID: 0, EMAIL: 1, NAME: 2, METHOD: 3, FIRST_SEEN: 4, LAST_SEEN: 5 };
const F = {
  ID: 0, EMAIL: 1,
  PRIMARY_INCOME: 2, FAMILY_INCOME: 3,
  TOTAL_EXPENDITURE: 4, TOTAL_SAVINGS: 5,
  PROFILE_JSON: 6, FINANCIAL_JSON: 7, UPDATED_AT: 8,
};

export function isSheetsConfigured(): boolean {
  return !!(SPREADSHEET_ID && CLIENT_EMAIL && PRIVATE_KEY);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  // CLIENT_EMAIL and PRIVATE_KEY are guaranteed non-null when isSheetsConfigured() is true
  const auth = new GoogleAuth({
    credentials: { client_email: CLIENT_EMAIL!, private_key: PRIVATE_KEY! },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("[googleSheetsService] Failed to obtain access token");
  return token;
}

async function readSheet(sheet: string): Promise<string[][]> {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}`;
  const res = await axios.get<{ values?: string[][] }>(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data.values ?? [];
}

async function appendRow(sheet: string, row: string[]): Promise<void> {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await axios.post(url, { values: [row] }, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function updateRow(sheet: string, rowNumber: number, row: string[]): Promise<void> {
  const token = await getAccessToken();
  // rowNumber is 1-based (row 1 = header)
  const range = `${sheet}!A${rowNumber}:Z${rowNumber}`;
  const url = `${SHEETS_BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  await axios.put(url, { values: [row] }, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Find a data row by email (skips header at index 0). Returns [rowArray, 1-based rowNumber] or null.
function findByEmail(rows: string[][], email: string): [string[], number] | null {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[U.EMAIL] === email) return [row, i + 1]; // +1 for 1-based sheet row
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record or refresh a user login in the "Users" sheet.
 * Idempotent — updates LastSeen if the email already exists.
 */
export async function upsertUserLogin(params: {
  uniqueId: string;
  email: string;
  name: string;
  loginMethod: "google" | "email";
}): Promise<void> {
  if (!isSheetsConfigured()) return;

  try {
    const rows = await readSheet(SHEET_USERS);
    const now  = new Date().toISOString();
    const hit  = findByEmail(rows, params.email);

    if (!hit) {
      await appendRow(SHEET_USERS, [
        params.uniqueId, params.email, params.name,
        params.loginMethod, now, now,
      ]);
      console.log(`[googleSheetsService] upsertUserLogin: new row for ${params.email}`);
    } else {
      const [row, rowNum] = hit;
      row[U.LAST_SEEN] = now;
      // Also update name in case it changed
      row[U.NAME] = params.name;
      await updateRow(SHEET_USERS, rowNum, row);
      console.log(`[googleSheetsService] upsertUserLogin: updated LastSeen for ${params.email}`);
    }
  } catch (err) {
    console.error("[googleSheetsService] upsertUserLogin failed:", err);
    // Graceful degradation — never throw; sheets is supplementary
  }
}

/**
 * Save or update a user's profile and financial data in the "FinancialData" sheet.
 * Passing undefined for profile or financialData leaves the existing value unchanged.
 */
export async function saveFinancialDataToSheet(params: {
  uniqueId: string;
  email: string;
  profile?: object;
  financialData?: object;
}): Promise<void> {
  if (!isSheetsConfigured()) return;

  try {
    const rows = await readSheet(SHEET_FINANCIAL);
    const now  = new Date().toISOString();
    const { profile } = params;
    // Use a loose cast so we can read dynamic fields without losing type safety elsewhere
    const fd = params.financialData as Record<string, unknown> | undefined;

    const primaryIncome    = String((fd?.primaryYearlyIncome  as number | undefined) ?? 0);
    const familyIncome     = String((fd?.familyYearlyIncome   as number | undefined) ?? 0);
    const expenditures     = Array.isArray(fd?.expenditures) ? (fd!.expenditures as { monthlyAmount?: number }[]) : [];
    const savings          = Array.isArray(fd?.savings)       ? (fd!.savings      as { monthlyContribution?: number }[]) : [];
    const totalExpenditure = String(expenditures.reduce((s, e)  => s + (e.monthlyAmount      || 0), 0));
    const totalSavings     = String(savings.reduce     ((s, sv) => s + (sv.monthlyContribution || 0), 0));
    const financialData    = fd;

    const hit = findByEmail(rows, params.email);

    if (!hit) {
      await appendRow(SHEET_FINANCIAL, [
        params.uniqueId, params.email,
        primaryIncome, familyIncome, totalExpenditure, totalSavings,
        profile ? JSON.stringify(profile) : "",
        financialData ? JSON.stringify(financialData) : "",
        now,
      ]);
      console.log(`[googleSheetsService] saveFinancialDataToSheet: new row for ${params.email}`);
    } else {
      const [row, rowNum] = hit;
      // Merge — only overwrite fields that were passed in
      if (financialData !== undefined) {
        row[F.PRIMARY_INCOME]      = primaryIncome;
        row[F.FAMILY_INCOME]       = familyIncome;
        row[F.TOTAL_EXPENDITURE]   = totalExpenditure;
        row[F.TOTAL_SAVINGS]       = totalSavings;
        row[F.FINANCIAL_JSON]      = JSON.stringify(financialData);
      }
      if (profile !== undefined) {
        row[F.PROFILE_JSON] = JSON.stringify(profile);
      }
      row[F.UPDATED_AT] = now;
      await updateRow(SHEET_FINANCIAL, rowNum, row);
      console.log(`[googleSheetsService] saveFinancialDataToSheet: updated row for ${params.email}`);
    }
  } catch (err) {
    console.error("[googleSheetsService] saveFinancialDataToSheet failed:", err);
  }
}

/**
 * Load a user's profile and financial data from the "FinancialData" sheet.
 * Returns null if the email is not found or sheets is not configured.
 */
export async function loadFinancialDataFromSheet(email: string): Promise<{
  uniqueId: string;
  profile?: object;
  financialData?: object;
} | null> {
  if (!isSheetsConfigured()) return null;

  try {
    const rows = await readSheet(SHEET_FINANCIAL);
    const hit  = findByEmail(rows, email);
    if (!hit) return null;

    const [row] = hit;
    const profileStr  = row[F.PROFILE_JSON];
    const finStr      = row[F.FINANCIAL_JSON];
    return {
      uniqueId:      row[F.ID] ?? "",
      profile:       profileStr ? JSON.parse(profileStr) : undefined,
      financialData: finStr     ? JSON.parse(finStr)     : undefined,
    };
  } catch (err) {
    console.error("[googleSheetsService] loadFinancialDataFromSheet failed:", err);
    return null;
  }
}
