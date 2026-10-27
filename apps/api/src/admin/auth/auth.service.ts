import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@instant-discount/db';
import { OAuth2Client } from 'google-auth-library';
import { APP_CONFIG, type AppConfig } from '../../config';
import { ApiError, unauthorized } from '../../common/api-error';
import { sha256Hex } from '../../common/crypto';
import { PrismaService } from '../../infra/prisma.service';
import { MailerService } from '../../mail/mailer.service';

const MAGIC_LINK_TTL_MS = 15 * 60_000;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly google = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Makes sure the bootstrap admins exist so the first person can sign in. */
  async onModuleInit() {
    for (const email of this.config.BOOTSTRAP_ADMIN_EMAILS) {
      await this.prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name: email.split('@')[0]!, role: 'ADMIN' },
      });
    }
  }

  /** Staff sign-in: verifies a Google ID token for the Workspace domain; the user must be registered. */
  async loginWithGoogle(idToken: string): Promise<User> {
    if (!this.config.GOOGLE_CLIENT_ID) {
      throw new ApiError(503, 'SSO_NOT_CONFIGURED', 'Google sign-in is not configured');
    }
    const ticket = await this.google
      .verifyIdToken({ idToken, audience: this.config.GOOGLE_CLIENT_ID })
      .catch(() => {
        throw unauthorized('Invalid Google token');
      });
    const payload = ticket.getPayload();
    if (
      !payload?.email ||
      !payload.email_verified ||
      payload.hd !== this.config.GOOGLE_HOSTED_DOMAIN
    ) {
      throw unauthorized(`Sign in with your @${this.config.GOOGLE_HOSTED_DOMAIN} Google account`);
    }

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email.toLowerCase() },
    });
    if (!user || !user.active || user.role === 'PARTNER_USER') {
      throw unauthorized('This account has no access. Ask an admin to invite you.');
    }
    if (user.googleSub && user.googleSub !== payload.sub)
      throw unauthorized('Google account mismatch');
    return this.prisma.user.update({
      where: { id: user.id },
      data: { googleSub: payload.sub, name: user.name || payload.name || user.email },
    });
  }

  /**
   * Partner sign-in, step 1. Always succeeds from the caller's point of view so the endpoint
   * cannot be used to discover which emails have accounts.
   */
  async requestMagicLink(email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user || !user.active || user.role !== 'PARTNER_USER') {
      this.logger.log(`Magic link requested for non-partner email ${normalized}; ignored`);
      return;
    }
    const token = randomBytes(32).toString('base64url');
    await this.prisma.magicLinkToken.create({
      data: {
        tokenHash: sha256Hex(token),
        email: normalized,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      },
    });
    const link = `${this.config.WEB_BASE_URL}/auth/magic?token=${token}`;
    await this.mailer.send({
      to: normalized,
      subject: 'Your Waffarha Instant Discount sign-in link',
      text: `Hello ${user.name},\n\nUse this link to sign in (valid for 15 minutes, one use):\n${link}\n\nIf you did not ask for it, ignore this email.`,
    });
  }

  /** Partner sign-in, step 2: consumes the one-time token. */
  async verifyMagicLink(token: string): Promise<User> {
    const tokenHash = sha256Hex(token);
    // Atomic single use: only one request can flip usedAt.
    const consumed = await this.prisma.magicLinkToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw unauthorized('This sign-in link is invalid or has expired');
    const { email } = await this.prisma.magicLinkToken.findUniqueOrThrow({ where: { tokenHash } });
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || user.role !== 'PARTNER_USER')
      throw unauthorized('This account has no access');
    return user;
  }

  async devLogin(email: string): Promise<User> {
    if (!this.config.DEV_LOGIN) throw new ApiError(404, 'HTTP_404', 'Not found');
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.active) throw unauthorized('No such active user');
    return user;
  }
}
