import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { unauthorized } from '../common/api-error';
import { safeEqualHex, signRequest } from '../common/crypto';
import { AcquirersService, type AuthenticatedAcquirer } from './acquirers.service';

type AcquirerRequest = Request & { rawBody?: Buffer; acquirer?: AuthenticatedAcquirer };

/**
 * Authenticates acquirer calls with an API key + HMAC request signature.
 * mTLS is terminated at the ingress; this guard is the application-level check.
 */
@Injectable()
export class AcquirerAuthGuard implements CanActivate {
  constructor(
    private readonly acquirers: AcquirersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AcquirerRequest>();
    const apiKey = req.header('x-api-key');
    const timestamp = req.header('x-timestamp');
    const signature = req.header('x-signature');
    if (!apiKey || !timestamp || !signature) {
      throw unauthorized('Missing X-Api-Key, X-Timestamp or X-Signature header');
    }

    const ts = Number(timestamp);
    if (
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - ts) > this.config.SIGNATURE_MAX_SKEW_SECONDS
    ) {
      throw unauthorized('X-Timestamp is missing or outside the allowed window');
    }

    const acquirer = await this.acquirers.findByApiKey(apiKey);
    if (!acquirer || !acquirer.active) throw unauthorized('Unknown or inactive API key');

    if (acquirer.ipAllowlist.length > 0 && !acquirer.ipAllowlist.includes(req.ip ?? '')) {
      throw unauthorized('Source IP is not allowed');
    }

    const expected = signRequest(
      acquirer.hmacSecret,
      timestamp,
      req.method,
      req.originalUrl,
      req.rawBody ?? Buffer.alloc(0),
    );
    if (!safeEqualHex(expected, signature)) throw unauthorized('Invalid signature');

    req.acquirer = acquirer;
    return true;
  }
}

export const CurrentAcquirer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedAcquirer =>
    ctx.switchToHttp().getRequest<AcquirerRequest>().acquirer!,
);
