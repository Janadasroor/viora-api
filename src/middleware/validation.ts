import type { Request, Response, NextFunction } from 'express';
import { sError } from 'sk-logger';
import { z, type ZodSchema } from 'zod';

interface ValidationSchemas {
    body?: ZodSchema;
    query?: ZodSchema;
    params?: ZodSchema;
}

/**
 * Middleware to validate request data using Zod schemas
 * @param schemas - Object containing Zod schemas for body, query, and/or params
 * @returns Express middleware function
 */
export const validate = (schemas: ValidationSchemas) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Validate request body
            if (schemas.body) {
                req.body = await schemas.body.parseAsync(req.body);
            }

            // Validate query parameters
            if (schemas.query) {
                const validatedQuery = await schemas.query.parseAsync(req.query);
                // Clear existing query params and assign validated ones
                Object.keys(req.query).forEach(key => delete (req.query as any)[key]);
                Object.assign(req.query, validatedQuery);
            }

            // Validate route parameters
            if (schemas.params) {
                const validatedParams = await schemas.params.parseAsync(req.params);
                // Clear existing params and assign validated ones
                Object.keys(req.params).forEach(key => delete req.params[key]);
                Object.assign(req.params, validatedParams);
            }

            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = formatZodError(error);

                return res.status(400).json({
                    success: false,
                    code: 'VALIDATION_ERROR',
                    message: 'Validation failed',
                    details: errors,
                    receivedBody: req.body // Debugging
                });
            }

            // Handle unexpected errors
            sError('Validation error:', error);
            return res.status(500).json({
                success: false,
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Internal server error during validation',
            });
        }
    };
};

/**
 * Helper to validate data without middleware (for use in services/utilities)
 */
export const validateData = async <T>(schema: ZodSchema<T>, data: unknown): Promise<T> => {
    return await schema.parseAsync(data);
};
function formatZodError(error: any) {
    const issues = error.issues || error.errors || [];
    const arr = new Array(issues.length);
    for (let i = 0; i < issues.length; i++) {
        const e = issues[i];
        arr[i] = { field: e.path.join("."), message: e.message };
    }
    return arr;
}

