import { db } from '@/db/db';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {betterAuth} from 'better-auth';
import { openAPI } from 'better-auth/plugins';
import type { Context } from 'hono';
import { adminUser } from '@/db/schema';
import { eq } from 'drizzle-orm';

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

/**
 * Middleware to authenticate and authorize admin users
 * Usage: app.get('/admin/route', requireAdmin, (c) => { ... })
 */
export const requireAdmin = async (c: Context, next: () => Promise<void>) => {
  try {
    // Get session from the request
    const session = await auth.api.getSession({ 
      headers: c.req.raw.headers 
    });

    // Check if user is authenticated
    if (!session || !session.user) {
      return c.json({ error: 'Unauthorized - Please login' }, 401);
    }

    // Check if user is an admin
    const admin = await db.query.adminUser.findFirst({
      where: eq(adminUser.userId, session.user.id),
    });

    if (!admin) {
      return c.json({ error: 'Forbidden - Admin access required' }, 403);
    }

    // Check if admin account is active
    if (!admin.isActive) {
      return c.json({ error: 'Forbidden - Admin account is inactive' }, 403);
    }

    // Attach user and admin info to context for use in route handlers
    c.set('user', session.user);
    c.set('admin', admin);

    await next();
  } catch (error) {
    console.error('Admin authentication error:', error);
    return c.json({ error: 'Internal server error during authentication' }, 500);
  }
};

/**
 * Middleware to check for specific admin roles
 * Usage: app.get('/super-admin/route', requireAdminRole(['super_admin']), (c) => { ... })
 */
export const requireAdminRole = (allowedRoles: string[]) => {
  return async (c: Context, next: () => Promise<void>) => {
    try {
      // Get session from the request
      const session = await auth.api.getSession({ 
        headers: c.req.raw.headers 
      });

      // Check if user is authenticated
      if (!session || !session.user) {
        return c.json({ error: 'Unauthorized - Please login' }, 401);
      }

      // Check if user is an admin
      const admin = await db.query.adminUser.findFirst({
        where: eq(adminUser.userId, session.user.id),
      });

      if (!admin) {
        return c.json({ error: 'Forbidden - Admin access required' }, 403);
      }

      // Check if admin account is active
      if (!admin.isActive) {
        return c.json({ error: 'Forbidden - Admin account is inactive' }, 403);
      }

      // Check if admin has the required role
      if (!allowedRoles.includes(admin.role)) {
        return c.json({ 
          error: `Forbidden - Requires one of the following roles: ${allowedRoles.join(', ')}` 
        }, 403);
      }

      // Attach user and admin info to context
      c.set('user', session.user);
      c.set('admin', admin);

      await next();
    } catch (error) {
      console.error('Admin role authentication error:', error);
      return c.json({ error: 'Internal server error during authentication' }, 500);
    }
  };
};

/**
 * Middleware to authenticate regular users (non-admin)
 * Usage: app.get('/protected/route', requireAuth, (c) => { ... })
 */
export const requireAuth = async (c: Context, next: () => Promise<void>) => {
  try {
    // Get session from the request
    const session = await auth.api.getSession({ 
      headers: c.req.raw.headers 
    });

    // Check if user is authenticated
    if (!session || !session.user) {
      return c.json({ error: 'Unauthorized - Please login' }, 401);
    }

    // Attach user info to context
    c.set('user', session.user);

    await next();
  } catch (error) {
    console.error('Authentication error:', error);
    return c.json({ error: 'Internal server error during authentication' }, 500);
  }
};