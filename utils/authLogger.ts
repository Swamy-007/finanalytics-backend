type AuthEvent =
  | "LOGIN_ATTEMPT"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "REGISTER_ATTEMPT"
  | "REGISTER_SUCCESS"
  | "REGISTER_FAILED"
  | "GOOGLE_AUTH_SUCCESS"
  | "GOOGLE_AUTH_FAILED";

interface LogEntry {
  event:   AuthEvent;
  email?:  string | undefined;
  ip?:     string | undefined;
  reason?: string | undefined;
  name?:   string | undefined;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function authLog(entry: LogEntry): void {
  const parts: string[] = [
    `[${timestamp()}]`,
    `[AUTH]`,
    entry.event,
  ];

  if (entry.email)  parts.push(`email=${entry.email}`);
  if (entry.name)   parts.push(`name="${entry.name}"`);
  if (entry.ip)     parts.push(`ip=${entry.ip}`);
  if (entry.reason) parts.push(`reason="${entry.reason}"`);

  const line = parts.join("  ");

  if (
    entry.event === "LOGIN_FAILED" ||
    entry.event === "REGISTER_FAILED" ||
    entry.event === "GOOGLE_AUTH_FAILED"
  ) {
    console.error(line);
  } else {
    console.log(line);
  }
}
