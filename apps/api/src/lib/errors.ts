interface AppErrorOptions {
  statusCode: number;
  code: string;
  details?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, options: AppErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is invalid.', details?: unknown) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'You need to log in to do that.') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'We could not find what you were looking for.') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That already exists.') {
    super(message, { statusCode: 409, code: 'CONFLICT' });
  }
}

export class NotImplementedError extends AppError {
  constructor(message = 'This capability is not available yet.') {
    super(message, { statusCode: 501, code: 'NOT_IMPLEMENTED' });
  }
}

/**
 * Thrown when a tenant-scoped query runs outside an authenticated request
 * context. This failing closed is what makes cross-tenant access impossible.
 */
export class MissingTenantContextError extends AppError {
  constructor() {
    super('Tenant context is missing for a tenant-scoped query.', {
      statusCode: 500,
      code: 'TENANT_CONTEXT_MISSING',
    });
  }
}
