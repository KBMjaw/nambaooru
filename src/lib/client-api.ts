'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

/** Fetch JSON from our own API; throws ApiError with the server's safe message. */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
      headers: opts.form ? undefined : opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? 'Error', data.details);
  return data as T;
}
