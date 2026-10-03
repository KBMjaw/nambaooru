export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string, public details?: unknown) {
    super(message ?? code);
  }
}
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Please log in');
export const forbidden = (m = 'You are not allowed to perform this action') => new HttpError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'NOT_FOUND', m);
export const badRequest = (m: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', m, details);
export const conflict = (m: string, details?: unknown) => new HttpError(409, 'CONFLICT', m, details);
