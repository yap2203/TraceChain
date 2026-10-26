import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  SIWE_DOMAIN: z.string().min(1).default('localhost:5173'),
  SIWE_URI: z.string().url().default('http://localhost:5173'),
  SIWE_CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  AUTH_COOKIE_NAME: z.string().min(1).default('tracechain_session'),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
});

export const env = environmentSchema.parse(process.env);
