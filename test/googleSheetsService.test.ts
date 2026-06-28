/**
 * Unit tests for googleSheetsService.
 *
 * google-auth-library and axios are fully mocked — no real HTTP calls or
 * credentials needed.  Two describe groups cover:
 *   1. "unconfigured"  — env vars absent → all functions silently no-op
 *   2. "configured"    — env vars present → full CRUD behaviour is exercised
 */
import { vi, describe, it, expect, beforeAll, afterEach } from "vitest";

// ── Stable mock instances (survive vi.resetModules) ───────────────────────────
const { mockGet, mockPost, mockPut, mockGetAccessToken } = vi.hoisted(() => ({
  mockGet:            vi.fn(),
  mockPost:           vi.fn(),
  mockPut:            vi.fn(),
  mockGetAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({ getAccessToken: mockGetAccessToken })),
}));

vi.mock("axios", () => ({
  default: { get: mockGet, post: mockPost, put: mockPut },
}));

// ── Test constants ─────────────────────────────────────────────────────────────
const SHEET_ID = "fake-sheet-id";

const USERS_HDR = ["UniqueId", "Email", "Name", "LoginMethod", "FirstSeen", "LastSeen"];
const FIN_HDR   = [
  "UniqueId", "Email", "PrimaryYearlyIncome", "FamilyYearlyIncome",
  "TotalMonthlyExpenditure", "TotalMonthlySavings",
  "ProfileJSON", "FinancialDataJSON", "UpdatedAt",
];

function sheetRows(values: string[][]): { data: { values: string[][] } } {
  return { data: { values } };
}

function lastPostRow(): string[] {
  const call = mockPost.mock.calls[0];
  if (!call) throw new Error("mockPost was never called");
  const body = call[1] as { values: string[][] };
  const row = body.values[0];
  if (!row) throw new Error("mockPost body.values[0] is undefined");
  return row;
}

function lastPutRow(): [string, string[]] {
  const call = mockPut.mock.calls[0];
  if (!call) throw new Error("mockPut was never called");
  const url  = call[0] as string;
  const body = call[1] as { values: string[][] };
  const row  = body.values[0];
  if (!row) throw new Error("mockPut body.values[0] is undefined");
  return [url, row];
}

// ── 1. Unconfigured — env vars absent ─────────────────────────────────────────

describe("googleSheetsService — unconfigured (env vars missing)", () => {
  let svc: typeof import("../services/googleSheetsService.js");

  beforeAll(async () => {
    const saved = {
      id:  process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      em:  process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      pk:  process.env.GOOGLE_SHEETS_PRIVATE_KEY,
    };

    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    delete process.env.GOOGLE_SHEETS_PRIVATE_KEY;

    vi.resetModules();
    svc = await import("../services/googleSheetsService.js");

    // restore so the "configured" suite starts with a clean slate
    if (saved.id !== undefined) process.env.GOOGLE_SHEETS_SPREADSHEET_ID = saved.id;
    if (saved.em !== undefined) process.env.GOOGLE_SHEETS_CLIENT_EMAIL   = saved.em;
    if (saved.pk !== undefined) process.env.GOOGLE_SHEETS_PRIVATE_KEY    = saved.pk;
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("isSheetsConfigured() returns false", () => {
    expect(svc.isSheetsConfigured()).toBe(false);
  });

  it("upsertUserLogin() makes no HTTP calls", async () => {
    await svc.upsertUserLogin({ uniqueId: "u1", email: "a@b.com", name: "A", loginMethod: "email" });
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("saveFinancialDataToSheet() makes no HTTP calls", async () => {
    await svc.saveFinancialDataToSheet({ uniqueId: "u1", email: "a@b.com" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("loadFinancialDataFromSheet() returns null without any HTTP call", async () => {
    const result = await svc.loadFinancialDataFromSheet("a@b.com");
    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ── 2. Configured — env vars present ──────────────────────────────────────────

describe("googleSheetsService — configured", () => {
  let svc: typeof import("../services/googleSheetsService.js");

  beforeAll(async () => {
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID = SHEET_ID;
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL   = "sa@test.com";
    process.env.GOOGLE_SHEETS_PRIVATE_KEY    = "fake-key";

    vi.resetModules();
    svc = await import("../services/googleSheetsService.js");
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("isSheetsConfigured() returns true", () => {
    expect(svc.isSheetsConfigured()).toBe(true);
  });

  // ── upsertUserLogin ────────────────────────────────────────────────────────

  describe("upsertUserLogin", () => {
    it("appends a new row when the email is not in the sheet", async () => {
      mockGet.mockResolvedValue(sheetRows([USERS_HDR]));
      mockPost.mockResolvedValue({ data: {} });

      await svc.upsertUserLogin({ uniqueId: "uid1", email: "new@test.com", name: "New User", loginMethod: "google" });

      expect(mockPost).toHaveBeenCalledOnce();
      const [url] = mockPost.mock.calls[0] as [string, unknown];
      expect(url).toContain("append");
      const row = lastPostRow();
      expect(row[0]).toBe("uid1");
      expect(row[1]).toBe("new@test.com");
      expect(row[2]).toBe("New User");
      expect(row[3]).toBe("google");
      expect(row[4]).toBe(row[5]); // FirstSeen == LastSeen on first insert
    });

    it("updates LastSeen and name when the email already exists", async () => {
      const existing = ["uid1", "old@test.com", "Old Name", "email",
                        "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"];
      mockGet.mockResolvedValue(sheetRows([USERS_HDR, existing]));
      mockPut.mockResolvedValue({ data: {} });

      await svc.upsertUserLogin({ uniqueId: "uid1", email: "old@test.com", name: "Updated Name", loginMethod: "email" });

      expect(mockPut).toHaveBeenCalledOnce();
      expect(mockPost).not.toHaveBeenCalled();

      const [url, row] = lastPutRow();
      expect(url).toContain("A2%3AZ2");                     // : is URL-encoded
      expect(row[2]).toBe("Updated Name");                  // Name updated
      expect(row[4]).toBe("2024-01-01T00:00:00.000Z");      // FirstSeen unchanged
      expect(row[5]).not.toBe("2024-01-01T00:00:00.000Z"); // LastSeen refreshed
    });

    it("swallows API errors without throwing (graceful degradation)", async () => {
      mockGet.mockRejectedValue(new Error("Sheets API down"));
      await expect(
        svc.upsertUserLogin({ uniqueId: "u", email: "e@e.com", name: "N", loginMethod: "email" })
      ).resolves.toBeUndefined();
    });
  });

  // ── saveFinancialDataToSheet ───────────────────────────────────────────────

  describe("saveFinancialDataToSheet", () => {
    it("appends a new row with computed income/expenditure/savings totals", async () => {
      mockGet.mockResolvedValue(sheetRows([FIN_HDR]));
      mockPost.mockResolvedValue({ data: {} });

      const financialData = {
        primaryYearlyIncome: 72000,
        familyYearlyIncome:  36000,
        expenditures: [{ monthlyAmount: 800 }, { monthlyAmount: 200 }],
        savings:      [{ monthlyContribution: 300 }, { monthlyContribution: 100 }],
      };

      await svc.saveFinancialDataToSheet({ uniqueId: "u2", email: "fin@test.com", financialData });

      expect(mockPost).toHaveBeenCalledOnce();
      const row = lastPostRow();
      expect(row[0]).toBe("u2");
      expect(row[1]).toBe("fin@test.com");
      expect(row[2]).toBe("72000");   // PrimaryYearlyIncome
      expect(row[3]).toBe("36000");   // FamilyYearlyIncome
      expect(row[4]).toBe("1000");    // TotalMonthlyExpenditure = 800 + 200
      expect(row[5]).toBe("400");     // TotalMonthlySavings = 300 + 100
      expect(row[6]).toBe("");        // ProfileJSON empty (not supplied)
      expect(JSON.parse(row[7] ?? "null")).toEqual(financialData);
    });

    it("updates only ProfileJSON when only profile is passed (financialData preserved)", async () => {
      const existingFin = JSON.stringify({ primaryYearlyIncome: 72000 });
      const existingRow = ["u2", "fin@test.com", "72000", "36000", "1000", "400", "", existingFin, "2024-01-01T00:00:00Z"];
      mockGet.mockResolvedValue(sheetRows([FIN_HDR, existingRow]));
      mockPut.mockResolvedValue({ data: {} });

      const profile = { firstName: "Jane", lastName: "Doe" };
      await svc.saveFinancialDataToSheet({ uniqueId: "u2", email: "fin@test.com", profile });

      const [, row] = lastPutRow();
      expect(JSON.parse(row[6] ?? "null")).toEqual(profile); // ProfileJSON written
      expect(row[7]).toBe(existingFin);                       // FinancialDataJSON preserved
    });

    it("updates only FinancialDataJSON when only financialData is passed (profile preserved)", async () => {
      const existingProfile = JSON.stringify({ firstName: "Jane" });
      const existingRow = ["u2", "fin@test.com", "60000", "30000", "1000", "400", existingProfile, "{}", "2024-01-01T00:00:00Z"];
      mockGet.mockResolvedValue(sheetRows([FIN_HDR, existingRow]));
      mockPut.mockResolvedValue({ data: {} });

      const financialData = { primaryYearlyIncome: 90000, familyYearlyIncome: 0, expenditures: [], savings: [], assets: [], liabilities: [] };
      await svc.saveFinancialDataToSheet({ uniqueId: "u2", email: "fin@test.com", financialData });

      const [, row] = lastPutRow();
      expect(row[6]).toBe(existingProfile);                       // ProfileJSON preserved
      expect(JSON.parse(row[7] ?? "null")).toEqual(financialData); // FinancialDataJSON updated
      expect(row[2]).toBe("90000");                               // income totals recalculated
    });

    it("swallows API errors without throwing (graceful degradation)", async () => {
      mockGet.mockRejectedValue(new Error("Network error"));
      await expect(
        svc.saveFinancialDataToSheet({ uniqueId: "u", email: "e@e.com" })
      ).resolves.toBeUndefined();
    });
  });

  // ── loadFinancialDataFromSheet ─────────────────────────────────────────────

  describe("loadFinancialDataFromSheet", () => {
    it("returns null when the email is not present in the sheet", async () => {
      mockGet.mockResolvedValue(sheetRows([FIN_HDR]));
      expect(await svc.loadFinancialDataFromSheet("ghost@test.com")).toBeNull();
    });

    it("returns parsed uniqueId, profile, and financialData for a known email", async () => {
      const profile = { firstName: "Bob", lastName: "Smith" };
      const fin     = { primaryYearlyIncome: 50000, expenditures: [], savings: [], assets: [], liabilities: [] };
      const dataRow = [
        "u3", "bob@test.com", "50000", "0", "0", "0",
        JSON.stringify(profile), JSON.stringify(fin), "2024-01-01",
      ];
      mockGet.mockResolvedValue(sheetRows([FIN_HDR, dataRow]));

      const result = await svc.loadFinancialDataFromSheet("bob@test.com");
      expect(result).not.toBeNull();
      expect(result!.uniqueId).toBe("u3");
      expect(result!.profile).toEqual(profile);
      expect(result!.financialData).toEqual(fin);
    });

    it("returns profile and financialData as undefined when JSON columns are empty", async () => {
      const dataRow = ["u4", "empty@test.com", "0", "0", "0", "0", "", "", "2024-01-01"];
      mockGet.mockResolvedValue(sheetRows([FIN_HDR, dataRow]));

      const result = await svc.loadFinancialDataFromSheet("empty@test.com");
      expect(result).not.toBeNull();
      expect(result!.profile).toBeUndefined();
      expect(result!.financialData).toBeUndefined();
    });

    it("returns null on API failure (graceful degradation)", async () => {
      mockGet.mockRejectedValue(new Error("Sheets down"));
      expect(await svc.loadFinancialDataFromSheet("x@y.com")).toBeNull();
    });
  });
});
