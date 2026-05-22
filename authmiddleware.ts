import type { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';

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
      audience: googleClientId
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

    next();

  } catch (error) {

    console.error(
      'Token verification failed:',
      error
    );

    res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
};

export default verifyGoogleToken;