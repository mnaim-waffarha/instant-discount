import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { User } from '@instant-discount/db';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod-pipe';
import { toUserDto } from '../users/users.mapper';
import { AdminAuthGuard, CurrentUser, type AdminRequest } from './admin-auth.guard';
import { AuthService } from './auth.service';
import { RateLimiter } from './rate-limiter.service';
import { Public, STAFF_ROLES, Roles } from './roles';
import { SESSION_COOKIE, SessionService } from './session.service';

const googleSchema = z.object({ idToken: z.string().min(10) });
const emailSchema = z.object({ email: z.string().email().max(254) });
const tokenSchema = z.object({ token: z.string().min(10).max(200) });

@Controller('admin/v1/auth')
@UseGuards(AdminAuthGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Post('google')
  @HttpCode(200)
  async google(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(googleSchema)) body: z.infer<typeof googleSchema>,
  ) {
    await this.limiter.hit(`login:${req.ip}`, 20, 900);
    return this.startSession(req, res, await this.auth.loginWithGoogle(body.idToken));
  }

  @Public()
  @Post('magic-link')
  @HttpCode(202)
  async magicLink(
    @Req() req: AdminRequest,
    @Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>,
  ) {
    await this.limiter.hit(`magic:${req.ip}`, 10, 900);
    await this.limiter.hit(`magic:${body.email.toLowerCase()}`, 5, 900);
    await this.auth.requestMagicLink(body.email);
    return { sent: true };
  }

  @Public()
  @Post('magic-link/verify')
  @HttpCode(200)
  async verify(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>,
  ) {
    await this.limiter.hit(`verify:${req.ip}`, 20, 900);
    return this.startSession(req, res, await this.auth.verifyMagicLink(body.token));
  }

  @Public()
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>,
  ) {
    return this.startSession(req, res, await this.auth.devLogin(body.email));
  }

  @Roles(...STAFF_ROLES, 'PARTNER_USER')
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AdminRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await this.sessions.revoke(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Roles(...STAFF_ROLES, 'PARTNER_USER')
  @Get('me')
  me(@CurrentUser() user: User) {
    return toUserDto(user);
  }

  private async startSession(req: AdminRequest, res: Response, user: User) {
    const { token } = await this.sessions.create(user.id, req.ip, req.header('user-agent'));
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions());
    return toUserDto(user);
  }
}
