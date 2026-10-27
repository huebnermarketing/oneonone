/**
 * HTTP error types thrown by lib code and mapped to responses by lib/api.ts. Kept separate from
 * lib/api.ts (which pulls in auth) so domain modules can throw them without import cycles.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, `${what} not found`)
export const forbidden = (message = 'Insufficient permissions') => new ApiError(403, message)
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, details)
export const conflict = (message: string) => new ApiError(409, message)
