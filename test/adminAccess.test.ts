/**
 * Admin access control integration tests.
 *
 * Uses REAL middleware (verifyAnyToken + verifySessionToken — pure HMAC, no
 * external HTTP), REAL dbService redirected to a temp db.json, and REAL
 * isAdmin() logic reading process.env.ADMIN_USER_IDS at call time.
 *
 * Only the Google Sheets service is mocked (outbound HTTP — acceptable per
 * instructions.md Testing Rules).
 *
 * Covers:
 *   1. isAdmin() reads env at call time, not module-init time
 *   2. GET /admin/users  → 403 non-admin, 200 admin
 *   3. GET /admin/analytics → 403 non-admin, 200 admin
 *   4. POST /auth/sync  → isAdmin flag correct in response
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";

// ── Only mock outbound HTTP (Google Sheets) ───────────────────────────────────
vi.mock("../services/googleSheetsService.js", () => ({
  upsertUserLogin:          vi.fn().mockResolvedValue(undefined),
  saveFinancialDataToSheet: vi.fn().mockResolvedValue(undefined),
  loadFinancialDataFromSheet: vi.fn().mockResolvedValue(null),
  isSheetsConfigured:       vi.fn().mockReturnValue(false),
}));
vi.mock("../utils/authLogger.js", () => ({ authLog: vi.fn() }));

// ── Temp db.json ──────────────────────────────────────────────────────────────
const TEMP_DB = join(tmpdir(), `finwise-admin-test-${Date.now()}.json`);

// ── Session tokens (real HMAC — no Google OAuth needed) ──────────────────────
// Import after env vars are set so SESSION_SECRET is available
let issueSessionToken: (id: string, email: string, name: string) => string;
let dbConfig: { dbPath: string };
let router: express.Router;

const ADMIN_EMAIL   = "admin@example.com";
const REGULAR_EMAIL = "user@example.com";
// UUIDs (36 chars) → loginMethod "email" branch in auth/sync
const ADMIN_ID   = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const REGULAR_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function agent() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return supertest(app);
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  // Write a minimal valid db.json so readDB() doesn't error
  await writeFile(TEMP_DB, JSON.stringify({ users: {}, products: [] }), "utf-8");

  // Set env vars before importing modules so process.env is ready
  process.env.SESSION_SECRET   = "test-secret-for-admin-tests";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.ADMIN_USER_IDS   = ADMIN_EMAIL;

  // Dynamic import so module-level code runs after env vars are set
  const tokenMod  = await import("../utils/sessionToken.js");
  const dbMod     = await import("../services/dbService.js");
  const routerMod = await import("../routes/apiRoutes.js");

  issueSessionToken = tokenMod.issueSessionToken;
  dbConfig          = dbMod.dbConfig;
  router            = routerMod.default;

  // Redirect dbService to temp file
  dbConfig.dbPath = TEMP_DB;
});

afterAll(async () => {
  await unlink(TEMP_DB).catch(() => {/* already gone */});
});

beforeEach(async () => {
  // Reset db to empty state before each test
  await writeFile(TEMP_DB, JSON.stringify({ users: {}, products: [] }), "utf-8");
});

// ── 1. isAdmin() reads env at call time via POST /auth/sync ───────────────────

describe("isAdmin — reads ADMIN_USER_IDS at call time", () => {
  it("returns isAdmin:true for an email in ADMIN_USER_IDS", async () => {
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL;
    const token = issueSessionToken(ADMIN_ID, ADMIN_EMAIL, "Admin User");
    const res = await agent()
      .post("/api/auth/sync")
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it("returns isAdmin:false for an email NOT in ADMIN_USER_IDS", async () => {
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL;
    const token = issueSessionToken(REGULAR_ID, REGULAR_EMAIL, "Regular User");
    const res = await agent()
      .post("/api/auth/sync")
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(false);
  });

  it("is case-insensitive", async () => {
    process.env.ADMIN_USER_IDS = "Admin@Example.COM";
    const token = issueSessionToken(ADMIN_ID, "admin@example.com", "Admin");
    const res = await agent()
      .post("/api/auth/sync")
      .set(authHeader(token));
    expect(res.body.isAdmin).toBe(true);
  });

  it("returns isAdmin:false when ADMIN_USER_IDS is empty", async () => {
    process.env.ADMIN_USER_IDS = "";
    const token = issueSessionToken(REGULAR_ID, REGULAR_EMAIL, "User");
    const res = await agent()
      .post("/api/auth/sync")
      .set(authHeader(token));
    expect(res.body.isAdmin).toBe(false);
  });

  it("returns isAdmin:false when ADMIN_USER_IDS is not set", async () => {
    delete process.env.ADMIN_USER_IDS;
    const token = issueSessionToken(REGULAR_ID, REGULAR_EMAIL, "User");
    const res = await agent()
      .post("/api/auth/sync")
      .set(authHeader(token));
    expect(res.body.isAdmin).toBe(false);
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL; // restore for subsequent tests
  });
});

// ── 2. GET /admin/users ───────────────────────────────────────────────────────

describe("GET /admin/users", () => {
  it("returns 401 with no auth header", async () => {
    const res = await agent().get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin user", async () => {
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL;
    const token = issueSessionToken(REGULAR_ID, REGULAR_EMAIL, "Regular");
    const res = await agent()
      .get("/api/admin/users")
      .set(authHeader(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("returns 200 and user list for an admin user", async () => {
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL;
    const token = issueSessionToken(ADMIN_ID, ADMIN_EMAIL, "Admin");
    const res = await agent()
      .get("/api/admin/users")
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── 3. GET /admin/analytics ───────────────────────────────────────────────────

describe("GET /admin/analytics", () => {
  it("returns 401 with no auth header", async () => {
    const res = await agent().get("/api/admin/analytics");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin user", async () => {
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL;
    const token = issueSessionToken(REGULAR_ID, REGULAR_EMAIL, "Regular");
    const res = await agent()
      .get("/api/admin/analytics")
      .set(authHeader(token));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("returns 200 with analytics shape for an admin user", async () => {
    process.env.ADMIN_USER_IDS = ADMIN_EMAIL;
    const token = issueSessionToken(ADMIN_ID, ADMIN_EMAIL, "Admin");
    const res = await agent()
      .get("/api/admin/analytics")
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(typeof res.body.totalUsers).toBe("number");
    expect(typeof res.body.averageScore).toBe("number");
  });
});
