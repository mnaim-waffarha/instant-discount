import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@instant-discount/db';
import { APP_CONFIG, type AppConfig } from '../../config';
import { sha256Hex } from '../../common/crypto';
import { PrismaService } from '../../infra/prisma.service';

export const SESSION_COOKIE = 'id_session';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get ttlMs() {
    return this.config.SESSION_TTL_HOURS * 3_600_000;
  }

  async create(
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.session.create({
      data: {
        tokenHash: sha256Hex(token),
        userId,
        expiresAt,
        ip,
        userAgent: userAgent?.slice(0, 256),
      },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return { token, expiresAt };
  }

  /** Returns the active user for a session token, extending the session when it is past half-life. */
  async resolve(token: string): Promise<User | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
    if (session.expiresAt.getTime() - Date.now() < this.ttlMs / 2) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + this.ttlMs) },
      });
    }
    return session.user;
  }

  async revoke(token: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }

  async revokeAll(userId: string) {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: this.ttlMs,
    };
  }
}
