import { Injectable } from '@nestjs/common';
import type { Country } from '@instant-discount/shared';
import { PrismaService } from '../infra/prisma.service';

export interface ResolvedTerminal {
  id: string;
  merchantId: string;
  /** The merchant's partner (for funding, settlement and experiment reports). */
  merchantPartnerId: string;
  branchId?: string;
  mcc: string;
  country: Country;
  active: boolean;
}

const CACHE_TTL_MS = 60_000;
/** Misses are cached briefly so newly registered entries are picked up quickly. */
const MISS_TTL_MS = 5_000;

/** Maps an acquirer's terminal id (TID) to our registry. Targeting uses our data, never the request's. */
@Injectable()
export class TerminalResolver {
  private readonly cache = new Map<string, { value: ResolvedTerminal | null; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(acquirerId: string, externalTerminalId: string): Promise<ResolvedTerminal | null> {
    const key = `${acquirerId}:${externalTerminalId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.terminal.findUnique({
      where: { acquirerId_externalTerminalId: { acquirerId, externalTerminalId } },
      include: { merchant: true },
    });
    const value: ResolvedTerminal | null = row && {
      id: row.id,
      merchantId: row.merchantId,
      merchantPartnerId: row.merchant.partnerId,
      branchId: row.branchId ?? undefined,
      mcc: row.mcc ?? row.merchant.mcc,
      country: row.merchant.country,
      active: row.active,
    };
    this.cache.set(key, { value, expiresAt: Date.now() + (value ? CACHE_TTL_MS : MISS_TTL_MS) });
    return value;
  }

  clear() {
    this.cache.clear();
  }
}
