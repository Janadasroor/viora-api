// utils.ts

import type { Request, Response, NextFunction } from 'express';

/**
 * Convert camelCase object keys to snake_case
 */
export const toSnakeCase = <T>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) return obj.map(item => toSnakeCase(item)) as unknown as T;

  if (typeof obj !== 'object') return obj;

  const snakeCaseObj: Record<string, any> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      snakeCaseObj[snakeKey] = toSnakeCase((obj as any)[key]);
    }
  }

  return snakeCaseObj as T;
};

/**
 * Format date to PostgreSQL format (YYYY-MM-DD)
 */
export const formatDateToPostgreSQL = (date: string | Date | null | undefined): string | null => {
  if (!date) return null;

  const d = new Date(date);

  if (isNaN(d.getTime())) throw new Error('Invalid date format');

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

/**
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate username format
 * - 3-30 characters
 * - Alphanumeric, underscores, and hyphens only
 * - Cannot start or end with underscore or hyphen
 */
export const isValidUsername = (username: string): boolean => {
  const usernameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9_-]{1,28}[a-zA-Z0-9])?$/;
  return usernameRegex.test(username);
};

/**
 * Sanitize string input
 */
export const sanitizeString = (str: string | null | undefined, maxLength = 255): string | null => {
  if (!str) return null;

  return str
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, '');
};

/**
 * Parse pagination parameters
 */
export const parsePagination = (page?: string | number, limit?: string | number, defaultLimit = 20, maxLimit = 100) => {
  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.min(maxLimit, Math.max(1, Number(limit) || defaultLimit));

  return {
    page: parsedPage,
    limit: parsedLimit,
    offset: (parsedPage - 1) * parsedLimit,
  };
};

/**
 * Create pagination response
 */
export const createPaginationResponse = (page: number, limit: number, total: number) => {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrevious: page > 1,
  };
};

/**
 * Handle async route errors
 */
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create success response
 */
export const successResponse = <T>(res: Response, data: T, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Create error response
 */
export const errorResponse = (res: Response, error: Error, statusCode = 500) => {
  return res.status(statusCode).json({
    success: false,
    error: error.message || 'Internal server error',
  });
};
