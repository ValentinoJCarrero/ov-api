import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Guards /admin/* API endpoints (not the panel HTML itself).
 * Accepts either:
 *  - X-Admin-Api-Key header / ?apiKey query param (admin panel)
 *  - Authorization: Bearer <ownerJwt> (owner dashboard login)
 *
 * Skips:
 *  - Non-/admin paths (webhook, etc.)
 *  - GET /admin (serves the panel HTML)
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path;

    if (!path.startsWith('/admin')) return true;

    if (path === '/admin' && request.method === 'GET') return true;

    const expectedKey = process.env.ADMIN_API_KEY;

    // Dev mode — no key configured
    if (!expectedKey) return true;

    // ── Option 1: Admin API key ──
    const apiKey = (request.headers['x-admin-api-key'] as string) || (request.query['apiKey'] as string);
    if (apiKey && apiKey === expectedKey) return true;

    // ── Option 2: Owner JWT ──
    const auth = request.headers['authorization'] as string;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
      try {
        const secret = process.env.OWNER_JWT_SECRET ?? 'ovapy-owner-secret';
        const payload = jwt.verify(token, secret) as any;
        (request as any).owner = payload;
        return true;
      } catch {
        // fall through to error below
      }
    }

    throw new UnauthorizedException('Invalid or missing credentials');
  }
}
