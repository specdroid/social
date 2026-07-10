import { z } from 'zod'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(16),
  DATABASE_URL: z.string().default('file:./dev.db'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  WA_ENABLED: z.coerce.boolean().default(true),
  WA_PROXY_URL: z.string().default(''),

  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_VERIFY_TOKEN: z.string().default(''),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_ID: z.string().default(''),
  STRIPE_SUCCESS_URL: z.string().default('http://localhost:5173/billing?success=true'),
  STRIPE_CANCEL_URL: z.string().default('http://localhost:5173/billing?canceled=true'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
