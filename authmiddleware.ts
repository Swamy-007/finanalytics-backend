import type { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';
import { authLog } from './utils/authLogger.js';
import { verifySessionToken } from './utils/sessionToken.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    picture: string;
  };
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;

if (!googleClientId) {
  throw new Error('Missing GOOGLE_CLIENT_ID');
}

const client = new OAuth2Client(googleClientId);

// Exported so apiRoutes can use it for the /auth/google-exchange endpoint
// without duplicating the client setup.
export async function verifyGoogleCredential(credential: string): Promise<TokenPayload | null> {
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: googleClientId! });
    return ticket.getPayload() ?? null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Verification failed';
    console.error(`[GOOGLE_AUTH_FAILED] reason="${reason}"`);
    return null;
  }
}

const verifyGoogleToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {

  try {

    // Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Missing Authorization header'
      });
      return;
    }

    // Extract Bearer token
    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        error: 'Missing token'
      });
      return;
    }

    // Verify token with Google
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: googleClientId!
    });

    const payload: TokenPayload | undefined =
      ticket.getPayload();

    if (!payload) {
      res.status(401).json({
        error: 'Invalid token payload'
      });
      return;
    }

    // Attach authenticated user
    req.user = {
      id: payload.sub,
      email: payload.email || '',
      name: payload.name || '',
      picture: payload.picture || ''
    };

    authLog({
      event: 'GOOGLE_AUTH_SUCCESS',
      email: payload.email,
      name:  payload.name,
      ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
          || req.socket.remoteAddress
          || 'unknown',
    });

    next();

  } catch (error) {

    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    const reason = error instanceof Error ? error.message : 'Token verification failed';
    // Log at console.error so the exact reason is visible in Cloud Run logs
    console.error(`[GOOGLE_AUTH_FAILED] ip=${ip} reason="${reason}"`);
    authLog({ event: 'GOOGLE_AUTH_FAILED', ip, reason });

    res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
};

// Accepts both Google OAuth JWTs and internal session tokens (email/password login).
export const verifyAnyToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  // Try internal session token first (fast, no network round-trip)
  const session = verifySessionToken(token);
  if (session) {
    req.user = { id: session.id, email: session.sub, name: session.name, picture: '' };
    next();
    return;
  }

  // Fall back to Google OAuth verification
  return verifyGoogleToken(req, res, next);
};

export default verifyGoogleToken;