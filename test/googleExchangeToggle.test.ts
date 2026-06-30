/**
 * Tests for the ENABLE_GOOGLE_EXCHANGE feature flag on POST /auth/google-exchange.
 *
 * The flag must default to disabled (501) so deploying this code does not change
 * existing prod behaviour unless explicitly flipped on. When enabled, the route
 * should verify the Google credential and issue a session token.
 *
 * Only outbound calls (Google credential verification, Sheets sync, auth logging)
 * are mocked — the route itself, session-token issuance, and the toggle check run
 * for real.
 */
import { vi, describe, it, expect, beforeAll, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";

const { mockVerifyGoogleCredential } = vi.hoisted(() => ({
  mockVerifyGoogleCredential: vi.fn(),
}));

vi.mock("../authmiddleware.js", async () => {
  const actual = await vi.importActual<typeof import("../authmiddleware.js")>("../authmiddleware.js");
  return {
    ...actual,
    verifyGoogleCredential: mockVerifyGoogleCredential,
  };
});
vi.mock("../services/googleSheetsService.js", () => ({
  upsertUserLogin:          vi.fn().mockResolvedValue(undefined),
  saveFinancialDataToSheet: vi.fn().mockResolvedValue(undefined),
  loadFinancialDataFromSheet: vi.fn().mockResolvedValue(null),
  isSheetsConfigured:       vi.fn().mockReturnValue(false),
}));
vi.mock("../utils/authLogger.js", () => ({ authLog: vi.fn() }));

let router: express.Router;

function agent() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return supertest(app);
}

beforeAll(async () => {
  process.env.SESSION_SECRET   = "test-secret-for-google-exchange-toggle";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";

  const routerMod = await import("../routes/apiRoutes.js");
  router = routerMod.default;
});

afterEach(() => {
  mockVerifyGoogleCredential.mockReset();
  delete process.env.ENABLE_GOOGLE_EXCHANGE;
});

describe("POST /auth/google-exchange — ENABLE_GOOGLE_EXCHANGE toggle", () => {
  it("returns 501 when ENABLE_GOOGLE_EXCHANGE is unset", async () => {
    const res = await agent()
      .post("/api/auth/google-exchange")
      .send({ credential: "fake-credential" });

    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not enabled/);
    expect(mockVerifyGoogleCredential).not.toHaveBeenCalled();
  });

  it("returns 501 when ENABLE_GOOGLE_EXCHANGE is \"false\"", async () => {
    process.env.ENABLE_GOOGLE_EXCHANGE = "false";
    const res = await agent()
      .post("/api/auth/google-exchange")
      .send({ credential: "fake-credential" });

    expect(res.status).toBe(501);
    expect(mockVerifyGoogleCredential).not.toHaveBeenCalled();
  });

  it("proceeds past the gate and issues a session token when ENABLE_GOOGLE_EXCHANGE=\"true\"", async () => {
    process.env.ENABLE_GOOGLE_EXCHANGE = "true";
    mockVerifyGoogleCredential.mockResolvedValue({
      sub: "1234567890",
      email: "user@example.com",
      name: "Test User",
    });

    const res = await agent()
      .post("/api/auth/google-exchange")
      .send({ credential: "valid-credential" });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("user@example.com");
    expect(res.body.name).toBe("Test User");
    expect(typeof res.body.sessionToken).toBe("string");
    expect(res.body.sessionToken.split(".").length).toBe(3);
    expect(mockVerifyGoogleCredential).toHaveBeenCalledWith("valid-credential");
  });

  it("returns 401 when the Google credential fails verification while enabled", async () => {
    process.env.ENABLE_GOOGLE_EXCHANGE = "true";
    mockVerifyGoogleCredential.mockResolvedValue(null);

    const res = await agent()
      .post("/api/auth/google-exchange")
      .send({ credential: "invalid-credential" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when enabled but no credential is provided", async () => {
    process.env.ENABLE_GOOGLE_EXCHANGE = "true";

    const res = await agent()
      .post("/api/auth/google-exchange")
      .send({});

    expect(res.status).toBe(400);
    expect(mockVerifyGoogleCredential).not.toHaveBeenCalled();
  });
});
