import { pool } from '../config/pg.config.js';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '@types';
import type { QueryResult } from 'pg';

const MAX_CMD_LEN = 200;
const MAX_QUERY_LEN = 1000;

interface Admin {
  id: string;
  username: string;
}

interface FindAdminParams {
  id?: string;
  username?: string;
}

interface PostgreSQLError extends Error {
  code?: string;
}

class AdminController {
  //#region data
  /**
   * Helper to find admin by id or username
   */

  private async findAdmin({ id, username }: FindAdminParams): Promise<Admin | null> {
    try {
      if (id) {
        const result: QueryResult = await pool.query(
          'SELECT id, username FROM admins WHERE id = $1',
          [id]
        );
        return result.rows && result.rows.length ? (result.rows[0] as Admin) : null;
      }

      if (username) {
        const result: QueryResult = await pool.query(
          'SELECT id, username FROM admins WHERE username = $1',
          [username]
        );
        return result.rows && result.rows.length ? (result.rows[0] as Admin) : null;
      }
      return null;
    } catch (err) {
      console.error('DB error in findAdmin:', err);
      throw err;
    }
  }

  /**
   * Add denied query
   * POST /api/admin/denied-queries
   */
  async addDeniedQuery(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const rawQuery = req.body?.query;
      const usernameFromToken = req.user?.username;

      // Validation
      if (!rawQuery || typeof rawQuery !== 'string') {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid 'query' field"
        });
      }

      const query = rawQuery.trim();

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Empty query'
        });
      }

      if (query.length > MAX_QUERY_LEN) {
        return res.status(400).json({
          success: false,
          error: `Query too long (max ${MAX_QUERY_LEN} characters)`
        });
      }

      if (!usernameFromToken) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Find admin
      const admin = await this.findAdmin({ username: usernameFromToken });

      if (!admin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const table = 'denied_queries';

      // Check for duplicates
      const existingResult: QueryResult = await pool.query(
        `SELECT id FROM ${table} WHERE query = $1`,
        [query]
      );

      if (existingResult.rows && existingResult.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Query already exists in denied list'
        });
      }

      // Insert new denied query - PostgreSQL uses RETURNING to get the inserted ID
      const result: QueryResult = await pool.query(
        `INSERT INTO ${table} (query, created_by) VALUES($1, $2) RETURNING id`,
        [query, admin.id]
      );

      if (result.rows && result.rows.length > 0) {
        return res.status(201).json({
          success: true,
          message: 'Query added successfully',
          data: { id: result.rows[0].id }
        });
      } else {
        console.warn('Insert did not return rows:', result);
        return res.status(500).json({
          success: false,
          error: 'Failed to add query'
        });
      }
    } catch (err) {
      const error = err as PostgreSQLError;
      console.error('DB error in addDeniedQuery:', error);

      // Handle duplicate key race condition (PostgreSQL uses '23505' for unique violation)
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Query already exists (unique constraint)'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error'
      });
    }
  }

  /**
   * Add denied command
   * POST /api/admin/denied-commands
   */
  async addDeniedCommand(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const rawCmd = req.body?.command;
      const usernameFromToken = req.user?.username;

      // Validation
      if (!rawCmd || typeof rawCmd !== 'string') {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid 'command' field"
        });
      }

      const command = rawCmd.trim();

      if (!command) {
        return res.status(400).json({
          success: false,
          error: 'Empty command'
        });
      }

      if (command.length > MAX_CMD_LEN) {
        return res.status(400).json({
          success: false,
          error: `Command too long (max ${MAX_CMD_LEN} characters)`
        });
      }

      if (/\r|\n/.test(command)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid command format (newlines not allowed)'
        });
      }

      if (!usernameFromToken) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Find admin
      const admin = await this.findAdmin({ username: usernameFromToken });

      if (!admin) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }

      const table = 'denied_commands';

      // Check for duplicates (case-insensitive)
      const existingResult: QueryResult = await pool.query(
        `SELECT id FROM ${table} WHERE LOWER(command) = LOWER($1)`,
        [command]
      );

      if (existingResult.rows && existingResult.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Command already exists in denied list'
        });
      }

      // Insert new denied command - PostgreSQL uses RETURNING to get the inserted ID
      const result: QueryResult = await pool.query(
        `INSERT INTO ${table} (command, created_by) VALUES($1, $2) RETURNING id`,
        [command, admin.id]
      );

      if (result.rows && result.rows.length > 0) {
        return res.status(201).json({
          success: true,
          message: 'Command added successfully',
          data: { id: result.rows[0].id }
        });
      } else {
        console.warn('Insert did not return rows:', result);
        return res.status(500).json({
          success: false,
          error: 'Failed to add command'
        });
      }
    } catch (err) {
      const error = err as PostgreSQLError;
      console.error('DB error in addDeniedCommand:', error);

      // Handle duplicate key race condition (PostgreSQL uses '23505' for unique violation)
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Command already exists (unique constraint)'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error'
      });
    }
  }
  //#endregion
}

export default new AdminController();