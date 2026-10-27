import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User, UserRole } from '@instant-discount/db';
import type { Request } from 'express';
import { ApiError, unauthorized } from '../../common/api-error';
import { PUBLIC_KEY, ROLES_KEY, STAFF_ROLES } from './roles';
import { SESSION_COOKIE, SessionService } from './session.service';

export type AdminRequest = Request & { user?: User; cookies: Record<string, string | undefined> };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Session-cookie authentication + role check for /admin/v1 routes.
 * Mutations must be JSON: a cross-site HTML form cannot send that without a CORS preflight,
 * which together with SameSite=Lax cookies protects against CSRF.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (MUTATING.has(req.method) && !req.is('application/json')) {
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must be application/json');
    }

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? await this.sessions.resolve(token) : null;
    if (!user) throw unauthorized('Not signed in');
    req.user = user;

    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? STAFF_ROLES;
    if (!allowed.includes(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Your role does not allow this action');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest<AdminRequest>().user!,
);
