import { z } from 'zod';

export const passwordSchema = z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/\d/);
export const mobileSchema = z.string().regex(/^[6-9]\d{9}$/);
