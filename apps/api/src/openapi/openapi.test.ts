import { Controller, Get } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { campaignInput } from '../admin/campaigns/campaign-input';
import { confirmSchema, inquireSchema, refundSchema } from '../discounts/dto';
import { CONTROLLERS, discoverRoutes } from './discover';
import { buildSpecs, matchRoutes } from './generate';
import { ROUTE_DOCS } from './routes';

describe('API docs', () => {
  const routes = discoverRoutes();

  it('documents every route, and only real routes', () => {
    expect(() => matchRoutes(routes)).not.toThrow();
    expect(Object.keys(ROUTE_DOCS).sort()).toEqual(routes.map((r) => r.key).sort());
  });

  it('fails when a route has no docs', () => {
    @Controller('admin/v1/undocumented')
    class UndocumentedController {
      @Get()
      list() {
        return [];
      }
    }
    expect(() => matchRoutes(discoverRoutes([...CONTROLLERS, UndocumentedController]))).toThrow(
      /GET \/admin\/v1\/undocumented/,
    );
  });

  it('reads request schemas from the validation pipes, so docs and validation are the same object', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    expect(byKey.get('POST /v1/discounts/inquire')?.body).toBe(inquireSchema);
    expect(byKey.get('POST /v1/discounts/:id/confirm')?.body).toBe(confirmSchema);
    expect(byKey.get('POST /v1/discounts/:id/refund')?.body).toBe(refundSchema);
    expect(byKey.get('POST /admin/v1/campaigns')?.body).toBe(campaignInput);
    expect(byKey.get('POST /v1/discounts/inquire')?.headers).toContain('idempotency-key');
  });

  it('reads roles from the controllers', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    expect(byKey.get('POST /admin/v1/campaigns/:id/approve')?.roles).toEqual(['ADMIN', 'APPROVER']);
    expect(byKey.get('GET /admin/v1/portal/campaigns')?.roles).toEqual(['PARTNER_USER']);
    expect(byKey.get('POST /admin/v1/auth/google')?.isPublic).toBe(true);
  });

  it('request examples are valid requests', () => {
    for (const route of routes) {
      const example = ROUTE_DOCS[route.key]?.requestExample;
      if (example === undefined) continue;
      expect(route.body, route.key).toBeDefined();
      const parsed = route.body!.safeParse(example);
      expect(parsed.success, `${route.key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('builds three specs with every reference resolvable', () => {
    const specs = buildSpecs();
    for (const [name, doc] of Object.entries(specs)) {
      const text = JSON.stringify(doc);
      const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
      for (const [, ref] of text.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g))
        expect(schemas[ref!], `${name}: ${ref}`).toBeDefined();
    }
    const paths = (name: string) => Object.keys(specs[name as 'admin'].paths as object);
    expect(paths('acquirer')).toEqual(
      expect.arrayContaining(['/v1/discounts/inquire', '/v1/discounts/{id}/refund']),
    );
    expect(paths('acquirer').some((p) => p.startsWith('/admin'))).toBe(false);
  });

  it('documents every reason an inquiry can be declined', () => {
    const notEligible = (
      buildSpecs().acquirer.components as {
        schemas: Record<string, { properties: { reason: { enum: string[] } } }>;
      }
    ).schemas.NotEligible!;
    expect(notEligible.properties.reason.enum).toEqual(
      expect.arrayContaining(['KILL_SWITCH', 'VELOCITY_LIMIT', 'NO_ELIGIBLE_CAMPAIGN']),
    );
  });
});
