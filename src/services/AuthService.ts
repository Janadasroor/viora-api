import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import authRepository from "../repositories/AuthRepository.js";
import transporter from "../config/transporter.config.js";
import {
  ValidationError,
  AuthenticationError,
  NotFoundError,
  ConflictError
} from "../AppErrors.js";
import dotenv from "dotenv";
import { sDebug, sError, sWarn } from "sk-logger";
import type { SafeUser } from "../types/api/auth.types.js";
import redisClient from "../config/redis.config.js";
dotenv.config();

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRATION = Number(process.env.ACCESS_TOKEN_EXPIRATION) || 30 * 60 * 1000; // 30 minutes
const REFRESH_TOKEN_EXPIRATION = Number(process.env.REFRESH_TOKEN_EXPIRATION) || 7 * 24 * 60 * 60 * 1000; // 7 days


interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

interface VerificationResponse {
  message: string;
}

interface RawUser {
  userId: string;
  username: string;
  email: string;
  accountStatus: string;
  emailVerified: boolean;
  passwordHash?: string;
  verificationCode?: string;
  codeExpiresAt?: Date;
  [key: string]: any;
}

class AuthService {
  // Token generation
  generateAccessToken(user: SafeUser): string {
    return jwt.sign(user, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRATION });
  }

  generateRefreshToken(user: SafeUser): string {
    return jwt.sign(user, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRATION });
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  sanitizeUser(user: RawUser): SafeUser {
    const { passwordHash, verificationCode, codeExpiresAt, ...safeUser } = user;
    return safeUser as SafeUser;
  }

  // Login
  async login(
    email: string,
    password: string,
    ipAddress: string,
    userAgent?: string
  ): Promise<AuthResponse> {
    const cachedUser = await redisClient.get(`user:email:${email}`);
    let user;

    if (cachedUser) {
      user = JSON.parse(cachedUser);
    } else {
      user = await authRepository.findUserByEmail(email);
      if (user) {
        // Cache for 1 hour
        await redisClient.set(`user:email:${email}`, JSON.stringify(user), { EX: 3600 });
      }
    }

    if (!user) {
      throw new AuthenticationError("Invalid credentials", "INVALID_CREDENTIALS");
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AuthenticationError("Invalid credentials", "INVALID_CREDENTIALS");
    }

    const safeUser: SafeUser = {
      userId: user.userId,
      email: user.email,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
      username: user.username
    };

    const accessToken = this.generateAccessToken(safeUser);
    const refreshToken = this.generateRefreshToken(safeUser);
    const hashedRefreshToken = this.hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const deviceInfo = { userAgent: userAgent || "unknown" };

    await authRepository.storeRefreshToken(
      user.userId,
      hashedRefreshToken,
      expiresAt,
      ipAddress,
      deviceInfo
    );

    return { accessToken, refreshToken, user: safeUser };
  }

  // Register
  async register(
    email: string,
    username: string,
    password: string,
    ipAddress: string,
    userAgent?: string
  ): Promise<AuthResponse> {
    const cleanUsername = String(username).trim();

    const existingUser = await authRepository.findUserByUsername(cleanUsername);
    if (existingUser) {
      throw new ConflictError("Username already exists", "USERNAME_TAKEN");
    }

    const existingEmail = await authRepository.findUserByEmail(email);
    if (existingEmail) {
      throw new ConflictError("Email already exists", "EMAIL_TAKEN");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userId = await authRepository.createUser(cleanUsername, email, hashedPassword);

    const safeUser: SafeUser = {
      userId: userId,
      username: cleanUsername,
      email: email,
      accountStatus: "suspended",
      emailVerified: false
    };

    const accessToken = this.generateAccessToken(safeUser);
    const refreshToken = this.generateRefreshToken(safeUser);
    const hashedRefreshToken = this.hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const deviceInfo = { userAgent: userAgent || "unknown" };

    await authRepository.storeRefreshToken(
      userId,
      hashedRefreshToken,
      expiresAt,
      ipAddress,
      deviceInfo
    );

    return { accessToken, refreshToken, user: safeUser };
  }

  // Request verification code
  async requestVerificationCode(email: string, userId: string): Promise<VerificationResponse> {
    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new NotFoundError("User not found", "USER_NOT_FOUND");
    }

    const emailOwner = await authRepository.checkEmailInUse(email, userId);
    if (emailOwner) {
      throw new ConflictError("Email already in use by another account", "EMAIL_TAKEN");
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    await authRepository.updateUserEmail(userId, email, code, expiry);

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Verify your Viora account",
      html: `
        <h2>Email Verification</h2>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p>This code will expire in 5 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      `,
      text: `Your verification code is ${code}. It expires in 5 minutes.`,
    });

    return { message: "Verification code sent successfully" };
  }

  // Verify code
  async verifyCode(
    email: string,
    code: string,
    ipAddress: string,
    userAgent?: string
  ): Promise<AuthResponse> {
    const user = await authRepository.findUserWithVerificationCode(email, code);
    if (!user) {
      throw new ValidationError("Invalid or expired verification code", "INVALID_CODE");
    }

    await authRepository.verifyUserEmail(user.userId);

    const safeUser = this.sanitizeUser(user);
    safeUser.emailVerified = true;
    safeUser.accountStatus = 'active';

    const accessToken = this.generateAccessToken(safeUser);
    const refreshToken = this.generateRefreshToken(safeUser);
    const hashedRefreshToken = this.hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const deviceInfo = { userAgent: userAgent || "unknown" };

    await authRepository.storeRefreshToken(
      user.userId,
      hashedRefreshToken,
      expiresAt,
      ipAddress,
      deviceInfo
    );

    return { accessToken, refreshToken, user: safeUser };
  }

  // Refresh token
  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    const oldHashedToken = this.hashToken(refreshToken);

    // Check for token reuse
    const reuseCheck = await authRepository.checkTokenReuse(oldHashedToken);

    if (reuseCheck.isReused && reuseCheck.userId) {
      // Token has been reused - revoke all tokens for this user
      sWarn(`⚠️ Token reuse detected for user ${reuseCheck.userId}. Revoking all tokens.`);
      await authRepository.revokeAllUserTokens(reuseCheck.userId);
      throw new AuthenticationError("Token reuse detected. All sessions have been terminated for security.", "TOKEN_REUSE_DETECTED");
    }

    const tokenData = await authRepository.findRefreshToken(oldHashedToken);

    if (!tokenData) {
      sError("AuthService:268", "Invalid refresh token");
      throw new AuthenticationError("Sign in again", "INVALID_TOKEN");
    }

    const user = await authRepository.findUserById(tokenData.userId);
    if (!user) {
      sError("AuthService:272", "User not found");
      throw new NotFoundError("User not found", "USER_NOT_FOUND");
    }

    const safeUser: SafeUser = {
      userId: user.userId,
      username: user.username,
      email: user.email,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified
    };

    const accessToken = this.generateAccessToken(safeUser);
    const newRefreshToken = this.generateRefreshToken(safeUser);
    const newHashedToken = this.hashToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await authRepository.updateRefreshToken(
      oldHashedToken,
      newHashedToken,
      newExpiresAt
    );

    return { accessToken, refreshToken: newRefreshToken, user: safeUser };
  }
  async logout(refreshToken: string): Promise<void> {
    const hashedToken = this.hashToken(refreshToken);
    await authRepository.deleteRefreshToken(hashedToken);
  }

  // Request password reset
  async requestPasswordReset(email: string): Promise<VerificationResponse> {
    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      // For security, don't reveal if user exists
      return { message: "If an account exists with this email, a reset code has been sent." };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await authRepository.storeResetCode(email, code, expiry);

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Reset your Viora password",
      html: `
        <h2>Password Reset</h2>
        <p>Your password reset code is: <strong>${code}</strong></p>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      `,
      text: `Your password reset code is ${code}. It expires in 15 minutes.`,
    });

    return { message: "If an account exists with this email, a reset code has been sent." };
  }

  // Reset password
  async resetPassword(email: string, code: string, newPassword: string): Promise<VerificationResponse> {
    const user = await authRepository.findUserByResetCode(email, code);
    if (!user) {
      throw new ValidationError("Invalid or expired reset code", "INVALID_CODE");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await authRepository.updatePassword(user.userId, hashedPassword);

    // Invalidate cache
    await redisClient.del(`user:email:${user.email}`);

    return { message: "Password reset successfully" };
  }

  // Change password
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<VerificationResponse> {
    const user = await authRepository.findUserByEmail((await authRepository.findUserById(userId))?.email || "");
    if (!user) {
      throw new NotFoundError("User not found", "USER_NOT_FOUND");
    }

    const isMatchCorrect = await bcrypt.compare(oldPassword, user.passwordHash);

    if (!isMatchCorrect) {
      throw new AuthenticationError("Invalid old password", "INVALID_PASSWORD");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await authRepository.updatePassword(userId, hashedPassword);

    // Invalidate cache
    await redisClient.del(`user:email:${user.email}`);

    return { message: "Password changed successfully" };
  }
}



export default new AuthService();