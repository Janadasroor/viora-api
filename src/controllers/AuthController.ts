import authService from '../services/AuthService.js';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '@types';
import { sError } from 'sk-logger';

const ACCESS_TOKEN_EXPIRATION = Number(process.env.ACCESS_TOKEN_EXPIRATION) || 30 * 60 * 1000; // 30 minutes
const REFRESH_TOKEN_EXPIRATION = Number(process.env.REFRESH_TOKEN_EXPIRATION) || 7 * 24 * 60 * 60 * 1000; // 7 days
const USER_COOKIE_EXPIRATION = Number(process.env.USER_COOKIE_EXPIRATION) || 7 * 24 * 60 * 60 * 1000; // 7 days
interface PostgresError extends Error {
  code?: string;
  status?: number;
}

class AuthController {
  constructor() {
    this.refreshToken = this.refreshToken.bind(this);
    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
    this.requestVerificationCode = this.requestVerificationCode.bind(this);
    this.verifyCode = this.verifyCode.bind(this);
    this.logout = this.logout.bind(this);
    this.requestPasswordReset = this.requestPasswordReset.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
    this.changePassword = this.changePassword.bind(this);
  }

  /**
   * Helper to extract IP address
   */
  private _getIpAddress(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (!forwarded) return req.ip || 'unknown';
    return forwarded?.toString().split(',')[0]?.trim() || req.ip || 'unknown';
  }

  /**
   * Helper to extract user agent
   */
  private _getUserAgent(req: Request): string {
    return req.headers['user-agent'] || 'unknown';
  }

  /**
   * Helper to set auth cookies
   */
  private _setAuthCookies(res: Response, accessToken: string, refreshToken: string, user?: any): void {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: ACCESS_TOKEN_EXPIRATION
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: REFRESH_TOKEN_EXPIRATION
    });

    if (user) {
      res.cookie('user', JSON.stringify(user), {
        httpOnly: false, // Allow client-side access if needed, or keep true for security
        sameSite: 'lax',
        secure: isProduction,
        maxAge: USER_COOKIE_EXPIRATION
      });
    }
  }

  /**
   * Helper to handle errors
   */
  private _handleError(res: Response, error: any): Response {
    sError('Controller error:', error);

    const status = error.status || error.statusCode;
    const errorCode = error.errorCode || 'UNKNOWN_ERROR';

    if (status && error.message) {
      return res.status(status).json({
        success: false,
        error: error.message,
        code: errorCode
      });
    }

    // Handle PostgreSQL errors
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({
        success: false,
        error: 'Resource already exists'
      });
    }

    if (error.code === '23503') { // Foreign key violation
      return res.status(400).json({
        success: false,
        error: 'Invalid reference'
      });
    }

    // Default error
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }

  /**
   * Login endpoint
   * POST /api/auth/login
   */
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const { email, password } = req.body || {};
      const ipAddress = this._getIpAddress(req);
      const userAgent = this._getUserAgent(req);

      const result = await authService.login(email, password, ipAddress, userAgent);

      this._setAuthCookies(res, result.accessToken, result.refreshToken, result.user);

      return res.status(200).json({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user
        },
        message: 'Login successful'
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Register endpoint
   * POST /api/auth/register
   */
  async register(req: Request, res: Response): Promise<Response> {
    try {
      const { email, username, password } = req.body || {};

      const ipAddress = this._getIpAddress(req);
      const userAgent = this._getUserAgent(req);

      const result = await authService.register(email, username, password, ipAddress, userAgent);

      this._setAuthCookies(res, result.accessToken, result.refreshToken, result.user);

      return res.status(201).json({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user
        },
        message: 'Account registered successfully. Please verify your email to activate your account.'
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Request verification code endpoint
   * POST /api/auth/request-verification
   */
  async requestVerificationCode(req: Request, res: Response): Promise<Response> {
    try {
      const { email, userId } = req.body || {};

      const result = await authService.requestVerificationCode(email, userId);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Verify code endpoint
   * POST /api/auth/verify
   */
  async verifyCode(req: Request, res: Response): Promise<Response> {
    try {
      const { email, code } = req.body || {};

      const ipAddress = this._getIpAddress(req);
      const userAgent = this._getUserAgent(req);

      const result = await authService.verifyCode(email, code, ipAddress, userAgent);

      this._setAuthCookies(res, result.accessToken, result.refreshToken, result.user);

      return res.status(200).json({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user
        },
        message: 'Email verified successfully'
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Refresh token endpoint
   * POST /api/auth/refresh
   */
  async refreshToken(req: Request, res: Response): Promise<Response> {
    try {
      let { refreshToken } = req.body || {};

      // If not in body, check cookies
      if (!refreshToken && req.cookies && req.cookies.refreshToken) {
        refreshToken = req.cookies.refreshToken;
      }

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          error: "Refresh token is missing",
          code: "AUTH_REQUIRED"
        });
      }

      const result = await authService.refreshToken(refreshToken);

      this._setAuthCookies(res, result.accessToken, result.refreshToken, result.user);

      return res.status(200).json({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken
        },
        message: 'Token refreshed successfully'
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Logout endpoint
   * POST /api/auth/logout
   */
  async logout(req: Request, res: Response): Promise<Response> {
    try {
      let { refreshToken } = req.body || {};

      // If not in body, check cookies
      if (!refreshToken && req.cookies && req.cookies.refreshToken) {
        refreshToken = req.cookies.refreshToken;
      }

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      // Clear cookies
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }
  /**
   * Request password reset endpoint
   * POST /api/auth/forgot-password
   */
  async requestPasswordReset(req: Request, res: Response): Promise<Response> {
    try {
      const { email } = req.body || {};

      const result = await authService.requestPasswordReset(email);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Reset password endpoint
   * POST /api/auth/reset-password
   */
  async resetPassword(req: Request, res: Response): Promise<Response> {
    try {
      const { email, code, newPassword } = req.body || {};

      const result = await authService.resetPassword(email, code, newPassword);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }

  /**
   * Change password endpoint
   * POST /api/auth/change-password
   */
  async changePassword(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { oldPassword, newPassword } = req.body || {};
      const userId = req.user?.userId;

      if (!userId) {
        throw new Error('Unauthorized');
      }

      const result = await authService.changePassword(userId, oldPassword, newPassword);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      return this._handleError(res, error as PostgresError);
    }
  }
}

export default new AuthController();