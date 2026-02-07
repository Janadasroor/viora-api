export class AppError extends Error {
  statusCode: number;
  errorCode: string | undefined;
  isOperational: boolean;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, errorCode: string = "VALIDATION_ERROR") {
    super(message, 400, errorCode);
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = "Invalid credentials", errorCode: string = "AUTHENTICATION_ERROR") {
    super(message, 401, errorCode);
    this.name = "AuthenticationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found", errorCode: string = "NOT_FOUND") {
    super(message, 404, errorCode);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource already exists", errorCode: string = "CONFLICT") {
    super(message, 409, errorCode);
    this.name = "ConflictError";
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = "Database operation failed", errorCode: string = "DATABASE_ERROR") {
    super(message, 500, errorCode);
    this.name = "DatabaseError";
  }
}