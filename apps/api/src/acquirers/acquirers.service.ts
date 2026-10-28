import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { decryptSecret } from '../common/crypto';
import { PrismaService } from '../infra/prisma.service';

export interface AuthenticatedAcquirer {
  id: string;
  name: string;
  country: string;
  hmacSecret: string;
  ipAllowlist: string[];
  active: boolean;
}

const CACHE_TTL_MS = 60_000;
/** Misses are cached briefly so newly registered entries are picked up quickly. */
const MISS_TTL_MS = 5_000;

@Injectable()
export class AcquirersService {
  private readonly cache = new Map<
    string,
    { value: AuthenticatedAcquirer | null; expiresAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async findByApiKey(apiKeyId: string): Promise<AuthenticatedAcquirer | null> {
    const cached = this.cache.get(apiKeyId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.acquirer.findUnique({ where: { apiKeyId } });
    const value = row && {
      id: row.id,
      name: row.name,
      country: row.country,
      hmacSecret: decryptSecret(this.config.SECRETS_ENCRYPTION_KEY, row.hmacSecretEnc),
      ipAllowlist: row.ipAllowlist,
      active: row.active,
    };
    this.cache.set(apiKeyId, {
      value,
      expiresAt: Date.now() + (value ? CACHE_TTL_MS : MISS_TTL_MS),
    });
    return value;
  }

  clear() {
    this.cache.clear();
  }
}
