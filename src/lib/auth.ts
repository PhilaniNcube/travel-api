import { db } from '@/db/db';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {betterAuth} from 'better-auth';
import { openAPI } from 'better-auth/plugins';

export const auth = betterAuth({
    emailAndPassword: {
    enabled: true,
    },
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  plugins: [
    openAPI()
  ],
});