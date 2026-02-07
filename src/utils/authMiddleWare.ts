// utils/authMiddleware.ts
dotenv.config();

import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { sDebug, sError, sLog, loggerConfig } from 'sk-logger';
import type { AuthenticatedRequest, CustomJwtPayload } from '@types';

const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET;

if (!JWT_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET is not defined in environment variables');
}

// Extend Express Request to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: CustomJwtPayload;
  }
}
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction, skipPathsFromSuspension: string[] = ['/users/complete-profile', '/users/current', '/complete-profile', '/current']) {
  const authHeader = req.get('Authorization');
  const bearerToken = authHeader?.split(' ')[1];
  const webToken = req.cookies.accessToken;
  const token = webToken || bearerToken;
  // Master token for development
  if (process.env.NODE_ENV === 'development' && token === '123456789') {
    req.user = {
      userId: '99999',
      username: 'dev_user',
      accountStatus: 'active',
      emailVerified: true,
      role: 'admin'
    };
    return next();
  }

  if (!token) {
    sLog("error", "no token");

    return res.status(401).json({
      code: 'AUTH_REQUIRED',
      message: 'Access token missing or invalid'
    });
  }

  try {
    if (!JWT_SECRET) {
      throw new Error('ACCESS_TOKEN_SECRET is not defined');
    }

    const decoded = jwt.verify(token, JWT_SECRET) as CustomJwtPayload;
    req.user = decoded;
    const email_verified = decoded.emailVerified;

    sLog("info", "Email verified:", email_verified);
    // sLog("Request path:", req.path);
    // sLog("Skip paths:", skipPathsFromSuspension);
    // sLog("Should skip?", skipPathsFromSuspension.includes(req.path));
    if (skipPathsFromSuspension.includes(req.path)) {
      sLog("Skipping authentication for path:", req.path);
      return next();
    }
    if (process.env.NODE_ENV === 'development') {
      // Track session even in development
      trackSession(req, decoded);
      return next();
    }
    if (!email_verified) {
      return res.status(403).json({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email to proceed'
      });
    }
    // Check account status - block suspended accounts
    if (decoded.accountStatus === 'suspended') {
      return res.status(403).json({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended or not verified. Please complete your profile.'
      });
    }

    // Track session for authenticated user
    trackSession(req, decoded);

    return next();
  } catch (err: any) {
    sError("JWT Error:", err.message);
    return res.status(401).json({
      code: 'TOKEN_EXPIRED',
      message: 'Access token invalid or expired'
    });
  }

}

/**
 * Track user session in Redis
 */
function trackSession(req: AuthenticatedRequest, decoded: CustomJwtPayload) {
  if (loggerConfig.sessionTracker) {
    const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
    loggerConfig.sessionTracker.registerSession(decoded.userId, {
      username: decoded.username,
      role: decoded.role || 'user',
      ipAddress
    }).catch((err: any) => {
      sError("Error tracking session:", err);
    });
  }
}

