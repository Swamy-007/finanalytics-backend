import ExcelJS from "exceljs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Mutable so tests can point at a temp file without mocking the whole module.
export const storageConfig = {
  usersFile: path.join(__dirname, "../../users.xlsx"),
};

export interface RegisteredUser {
  id:           string;
  name:         string;
  email:        string;
  passwordHash: string;
  createdAt:    string;
}

// ── Password helpers (pure, no I/O) ──────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  // timingSafeEqual requires equal-length buffers; length mismatch means wrong hash
  if (derived.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(hash, "hex"));
}

// ── Excel helpers ─────────────────────────────────────────────────────────────

const COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "id",           key: "id" },
  { header: "name",         key: "name" },
  { header: "email",        key: "email" },
  { header: "passwordHash", key: "passwordHash" },
  { header: "createdAt",    key: "createdAt" },
];

async function openWorkbook(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(storageConfig.usersFile);
    let ws = wb.getWorksheet("Users");
    if (!ws) ws = wb.addWorksheet("Users");
    // Re-apply column key mappings — ExcelJS does not restore them on read,
    // so addRow({ id, name, ... }) would silently write empty cells without this.
    ws.columns = COLUMNS;
  } catch {
    // File does not exist yet — create it with headers
    const ws = wb.addWorksheet("Users");
    ws.columns = COLUMNS;
    await wb.xlsx.writeFile(storageConfig.usersFile);
  }
  return wb;
}

function getSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.getWorksheet("Users");
  if (!ws) throw new Error("Users sheet not found");
  return ws;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<RegisteredUser | null> {
  const wb = await openWorkbook();
  const ws = getSheet(wb);
  let found: RegisteredUser | null = null;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // header row
    const rowEmail = String(row.getCell("email").value ?? "");
    if (rowEmail === email) {
      found = {
        id:           String(row.getCell("id").value ?? ""),
        name:         String(row.getCell("name").value ?? ""),
        email:        rowEmail,
        passwordHash: String(row.getCell("passwordHash").value ?? ""),
        createdAt:    String(row.getCell("createdAt").value ?? ""),
      };
    }
  });

  return found;
}

export async function loginUser(email: string, password: string): Promise<RegisteredUser> {
  const user = await findUserByEmail(email.trim().toLowerCase());
  if (!user) throw new Error("Invalid email or password");
  if (!verifyPassword(password, user.passwordHash)) throw new Error("Invalid email or password");
  return user;
}

export async function registerUser(
  name: string,
  email: string,
  password: string
): Promise<RegisteredUser> {
  const existing = await findUserByEmail(email);
  if (existing) throw new Error("Email already registered");

  const user: RegisteredUser = {
    id:           crypto.randomUUID(),
    name:         name.trim(),
    email:        email.trim().toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt:    new Date().toISOString(),
  };

  const wb = await openWorkbook();
  const ws = getSheet(wb);
  ws.addRow({
    id:           user.id,
    name:         user.name,
    email:        user.email,
    passwordHash: user.passwordHash,
    createdAt:    user.createdAt,
  });
  await wb.xlsx.writeFile(storageConfig.usersFile);

  return user;
}
