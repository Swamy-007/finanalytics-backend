/**
 * userService integration tests — NO ExcelJS mocking.
 *
 * Each suite writes and reads a real .xlsx file in os.tmpdir().
 * This is the only way to catch bugs like "column key mappings not
 * restored on readFile()", which previously passed with a mock but
 * broke in production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";

import {
  storageConfig,
  hashPassword,
  verifyPassword,
  registerUser,
  findUserByEmail,
  loginUser,
} from "../services/userService.js";

// ── Temp file setup ───────────────────────────────────────────────────────────

const TEST_XLSX = join(tmpdir(), `finwise-users-test-${Date.now()}.xlsx`);

beforeAll(() => {
  // Redirect all service I/O to the temp file for this test run
  storageConfig.usersFile = TEST_XLSX;
});

afterAll(async () => {
  try { await unlink(TEST_XLSX); } catch { /* already gone */ }
});

// ── hashPassword / verifyPassword (pure, no I/O) ──────────────────────────────

describe("hashPassword", () => {
  it("returns salt:hash format", () => {
    expect(hashPassword("secret123")).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("produces a different hash each call (random salt)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("never stores the plain-text password", () => {
    expect(hashPassword("mypassword")).not.toContain("mypassword");
  });
});

describe("verifyPassword", () => {
  it("returns true for the correct password", () => {
    const h = hashPassword("correct");
    expect(verifyPassword("correct", h)).toBe(true);
  });

  it("returns false for the wrong password", () => {
    const h = hashPassword("correct");
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("returns false when the hash part is tampered (length mismatch)", () => {
    const h = hashPassword("secret");
    const salt = h.split(":")[0];
    expect(verifyPassword("secret", `${salt}:deadbeef`)).toBe(false);
  });

  it("returns false for a malformed stored value", () => {
    expect(verifyPassword("anything", "notavalidhash")).toBe(false);
  });
});

// ── registerUser — writes a real row to the temp .xlsx file ───────────────────

describe("registerUser", () => {
  it("creates a new user and the returned record has the expected fields", async () => {
    const user = await registerUser("Alice", "alice@example.com", "pass1234");
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.id).toBeTruthy();
    expect(user.createdAt).toBeTruthy();
  });

  it("stores a scrypt hash, not the plain-text password", async () => {
    const user = await registerUser("Bob", "bob@example.com", "mysecret");
    expect(user.passwordHash).not.toContain("mysecret");
    expect(user.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it("normalises the email to lowercase before saving", async () => {
    const user = await registerUser("Carol", "Carol@EXAMPLE.COM", "pass1234");
    expect(user.email).toBe("carol@example.com");
  });

  it("throws 'Email already registered' on a duplicate email", async () => {
    await expect(
      registerUser("Dup", "alice@example.com", "pass1234")
    ).rejects.toThrow("Email already registered");
  });
});

// ── findUserByEmail — reads back what registerUser wrote ──────────────────────

describe("findUserByEmail", () => {
  it("finds a user that was previously registered", async () => {
    const found = await findUserByEmail("alice@example.com");
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Alice");
  });

  it("returns null for an email that was never registered", async () => {
    const found = await findUserByEmail("nobody@example.com");
    expect(found).toBeNull();
  });

  it("returns the stored hash (not the plain password) in the record", async () => {
    const found = await findUserByEmail("bob@example.com");
    expect(found?.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(found?.passwordHash).not.toContain("mysecret");
  });
});

// ── loginUser — reads hash from the real Excel file and verifies it ───────────

describe("loginUser", () => {
  it("returns the user record for correct credentials", async () => {
    const user = await loginUser("alice@example.com", "pass1234");
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
  });

  it("reads the stored hash from Excel and accepts the matching password", async () => {
    // bob's password was set to 'mysecret' during registerUser tests above
    await expect(loginUser("bob@example.com", "mysecret")).resolves.toBeTruthy();
  });

  it("throws for the wrong password", async () => {
    await expect(
      loginUser("alice@example.com", "wrongpass")
    ).rejects.toThrow("Invalid email or password");
  });

  it("throws for an email not in the Excel file", async () => {
    await expect(
      loginUser("ghost@example.com", "pass1234")
    ).rejects.toThrow("Invalid email or password");
  });

  it("is case-insensitive on email lookup", async () => {
    await expect(loginUser("Alice@EXAMPLE.COM", "pass1234")).resolves.toBeTruthy();
  });

  it("does not return the plain-text password in any field", async () => {
    const user = await loginUser("alice@example.com", "pass1234");
    const serialised = JSON.stringify(user);
    expect(serialised).not.toContain("pass1234");
  });
});
