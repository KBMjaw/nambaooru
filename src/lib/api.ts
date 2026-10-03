import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { HttpError } from './errors';

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response | unknown>;

/**
 * Wraps a route handler: same-origin check for state-changing requests (CSRF defence
 * in addition to SameSite cookies), uniform JSON errors, no stack traces leaked.
 */
export function route<C = unknown>(fn: Handler<C>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.get('origin');
        const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
        if (origin && host && new URL(origin).host !== host) {
          throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request blocked');
        }
      }
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status });
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: 'VALIDATION', message: 'Please check the highlighted fields', details: e.flatten().fieldErrors },
          { status: 400 },
        );
      }
      // Next.js redirect()/notFound() control-flow errors must propagate
      if (e && typeof e === 'object' && 'digest' in e) throw e;
      console.error('[api]', req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Invalid request body');
  }
  return schema.parse(json);
}
