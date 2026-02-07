import { sDebug } from "sk-logger";
import { pool } from "../config/pg.config.js";
import type { PoolClient } from "pg";
import { toCamel } from "@/utils/toCamel.js";
import snowflakeService from "../services/SnowflakeService.js";

interface User {
  userId: string;
  email: string;
  passwordHash: string;
  accountStatus: string;
  emailVerified: boolean;
  username: string;
}

interface UserBasic {
  userId: string;
  username: string;
  email: string;
  accountStatus: string;
  emailVerified: boolean;
}

interface UserIdOnly {
  userId: string;
}

interface EmailCheckResult {
  userId: string;
  emailVerified: boolean;
}

interface RefreshTokenResult {
  userId: string;
}

interface DeviceInfo {
  userAgent?: string;
  platform?: string;
  [key: string]: any;
}

class AuthRepository {
  // User queries
  async findUserByEmail(email: string): Promise<User | undefined> {
    const result = await pool.query(
      `SELECT user_id, email, password_hash, account_status, email_verified, username
       FROM users WHERE email = $1`,
      [email]
    );
    return toCamel(result.rows[0]);
  }

  async findUserById(userId: string): Promise<UserBasic | undefined> {
    const result = await pool.query(
      `SELECT user_id, username, email, account_status, email_verified
       FROM users WHERE user_id = $1`,
      [userId]
    );
    return toCamel(result.rows[0]);
  }

  async findUserByUsername(username: string): Promise<UserIdOnly | undefined> {
    const result = await pool.query(
      "SELECT user_id FROM users WHERE username = $1",
      [username]
    );
    return toCamel(result.rows[0]);
  }

  async findUserWithVerificationCode(email: string, code: string): Promise<User | undefined> {
    const result = await pool.query(
      `SELECT * FROM users 
       WHERE email = $1 AND verification_code = $2 AND code_expires_at > NOW()`,
      [email, code]
    );
    return toCamel(result.rows[0]);
  }

  async checkEmailInUse(email: string, excludeUserId: string): Promise<EmailCheckResult | undefined> {
    const result = await pool.query(
      "SELECT user_id, email_verified FROM users WHERE email = $1 AND user_id != $2",
      [email, excludeUserId]
    );
    return toCamel(result.rows[0]);
  }

  async createUser(username: string, email: string, hashedPassword: string): Promise<string> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");

      const userId = snowflakeService.generate();

      await client.query(
        `INSERT INTO users (user_id, username, email, password_hash, account_status, email_verified) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, username, email, hashedPassword, "suspended", false]
      );

      await client.query(
        "INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)",
        [userId, username]
      );

      await client.query("COMMIT");
      return userId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateUserEmail(userId: string, email: string, verificationCode: string, expiry: Date): Promise<void> {
    await pool.query(
      `UPDATE users 
       SET email = $1, verification_code = $2, code_expires_at = $3, email_verified = false 
       WHERE user_id = $4`,
      [email, verificationCode, expiry, userId]
    );
  }

  async verifyUserEmail(userId: string): Promise<void> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE users 
         SET email_verified = true, 
             account_status = 'active', 
             verification_code = NULL, 
             code_expires_at = NULL 
         WHERE user_id = $1`,
        [userId]
      );

      await client.query(
        `UPDATE auth_tokens 
         SET revoked_at = NOW() 
         WHERE user_id = $1 AND token_type = 'refresh' AND revoked_at IS NULL`,
        [userId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // Token queries
  async storeRefreshToken(
    userId: string,
    hashedToken: string,
    expiresAt: Date,
    ipAddress: string,
    deviceInfo: DeviceInfo
  ): Promise<void> {
    await pool.query(
      `INSERT INTO auth_tokens
        (user_id, token_hash, token_type, expires_at, ip_address, device_info)
       VALUES ($1, $2, 'refresh', $3, $4, $5)`,
      [userId, hashedToken, expiresAt, ipAddress, JSON.stringify(deviceInfo)]
    );
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenResult | undefined> {
    sDebug(tokenHash);
    const result = await pool.query(
      "SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND token_type = 'refresh' AND revoked_at IS NULL AND expires_at > NOW()",
      [tokenHash]
    );
    sDebug(result.rows);
    return toCamel(result.rows[0]);
  }

  async updateRefreshToken(oldHashedToken: string, newHashedToken: string, expiresAt: Date): Promise<void> {
    await pool.query(
      "UPDATE auth_tokens SET token_hash = $1, expires_at = $2 WHERE token_hash = $3",
      [newHashedToken, expiresAt, oldHashedToken]
    );
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    await pool.query(
      "UPDATE auth_tokens SET revoked_at = NOW() WHERE token_hash = $1",
      [tokenHash]
    );
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await pool.query(
      "UPDATE auth_tokens SET revoked_at = NOW() WHERE user_id = $1 AND token_type = 'refresh' AND revoked_at IS NULL",
      [userId]
    );
  }

  async checkTokenReuse(tokenHash: string): Promise<{ isReused: boolean; userId?: string }> {
    const result = await pool.query(
      "SELECT user_id, revoked_at FROM auth_tokens WHERE token_hash = $1 AND token_type = 'refresh'",
      [tokenHash]
    );

    if (!result.rows[0]) {
      return { isReused: false };
    }

    const token = result.rows[0];

    // If token exists but is revoked, it's been reused
    if (token.revoked_at) {
      return { isReused: true, userId: token.user_id };
    }

    return { isReused: false, userId: token.user_id };
  }
  async storeResetCode(email: string, code: string, expiry: Date): Promise<void> {
    await pool.query(
      `UPDATE users 
       SET verification_code = $1, code_expires_at = $2 
       WHERE email = $3`,
      [code, expiry, email]
    );
  }

  async findUserByResetCode(email: string, code: string): Promise<User | undefined> {
    return this.findUserWithVerificationCode(email, code);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await pool.query(
      `UPDATE users 
       SET password_hash = $1, verification_code = NULL, code_expires_at = NULL 
       WHERE user_id = $2`,
      [passwordHash, userId]
    );
  }
}

export default new AuthRepository();