import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { stringify } from 'yaml';
import { z, type AnyZodObject, type ZodTypeAny } from 'zod';
import type { UserRole } from '@instant-discount/db';
import { STAFF_ROLES } from '../admin/auth/roles';
import { safetySchema } from '../safety/settings.service';
import { COMPONENTS, MODELS } from './components';
import { discoverRoutes, type DiscoveredRoute } from './discover';
import { ROUTE_DOCS, type RouteDoc, type SpecName } from './routes';
import { enumComponents, modelComponents, ref, type Schema } from './schemas';
import { SPECS } from './specs';

extendZodWithOpenApi(z);

const ALL_ROLES: UserRole[] = [...STAFF_ROLES, 'PARTNER_USER'];
const ERROR = { content: { 'application/json': { schema: ref('Error') } } };
const err = (description: string) => ({ description, ...ERROR });

/**
 * `z.coerce.date()` accepts null (it becomes the epoch), so the converter marks it nullable and
 * gives no format. Tag date nodes with `format: date-time` (docs-only metadata; validation is
 * unaffected) and drop the bogus null afterwards in `fixDates`.
 */
function annotateDates(schema: ZodTypeAny | undefined, seen = new Set<unknown>()): boolean {
  if (!schema || seen.has(schema)) return false;
  seen.add(schema);
  const def = schema._def as Record<string, unknown> & { typeName?: string; openapi?: unknown };
  const tag = () => (def.openapi ??= { metadata: { format: 'date-time' } });
  if (def.typeName === 'ZodDate') return !!tag();
  // Wrappers around a date (optional, default, nullable, effects) need the tag too: schemas
  // built before extendZodWithOpenApi do not pass inner metadata through their wrappers.
  const wrapped = def.innerType ?? def.schema;
  if (wrapped && typeof wrapped === 'object' && '_def' in wrapped) {
    if (annotateDates(wrapped as ZodTypeAny, seen)) return !!tag();
    return false;
  }
  const children: unknown[] = [
    def.type,
    def.left,
    def.right,
    def.valueType,
    ...(Array.isArray(def.options) ? def.options : []),
    ...(def.options instanceof Map ? [...def.options.values()] : []),
    ...(typeof def.shape === 'function' ? Object.values((def.shape as () => object)()) : []),
  ];
  for (const child of children)
    if (child && typeof child === 'object' && '_def' in child)
      annotateDates(child as ZodTypeAny, seen);
  return false;
}

function fixDates(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(fixDates);
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.format === 'date-time' && Array.isArray(o.type) && o.type.includes('null'))
    o.type = 'string';
  // A computed default (e.g. "now") would change on every run; describe it instead.
  if (o.format === 'date-time' && (typeof o.default === 'string' || o.default instanceof Date)) {
    delete o.default;
    o.description = [o.description, 'Defaults to the current time.'].filter(Boolean).join(' ');
  }
  Object.values(o).forEach(fixDates);
}

/** Pairs every discovered route with its doc entry; throws listing any gap in either direction. */
export function matchRoutes(routes = discoverRoutes()) {
  const keys = new Set(routes.map((r) => r.key));
  const missing = routes.filter((r) => !ROUTE_DOCS[r.key]).map((r) => r.key);
  const stale = Object.keys(ROUTE_DOCS).filter((k) => !keys.has(k));
  if (missing.length || stale.length) {
    throw new Error(
      [
        missing.length &&
          `Routes without docs (add them to src/openapi/routes.ts):\n  ${missing.join('\n  ')}`,
        stale.length && `Docs for routes that no longer exist:\n  ${stale.join('\n  ')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return routes.map((route) => ({ route, doc: ROUTE_DOCS[route.key]! }));
}

function security(spec: SpecName, route: DiscoveredRoute): Array<Record<string, string[]>> {
  if (spec === 'acquirer') return [{ AcquirerHmac: [] }];
  if (route.key === 'GET /metrics') return [{ MetricsToken: [] }, {}];
  if (spec === 'ops' || route.isPublic) return [];
  return [{ SessionCookie: [] }];
}

function rolesLine(roles: UserRole[] | null) {
  if (!roles) return '';
  const all = ALL_ROLES.every((r) => roles.includes(r));
  const staff =
    !all && STAFF_ROLES.every((r) => roles.includes(r)) && roles.length === STAFF_ROLES.length;
  return `**Roles:** ${all ? 'any signed-in user' : staff ? 'any staff role' : roles.join(', ')}`;
}

function registerRoute(registry: OpenAPIRegistry, route: DiscoveredRoute, doc: RouteDoc) {
  annotateDates(route.body);
  annotateDates(route.query);
  const path = route.path.replace(/:([A-Za-z_]+)/g, '{$1}');
  const params = route.pathParams.length
    ? z.object(
        Object.fromEntries(
          route.pathParams.map((p) => [
            p,
            z.string().openapi({
              description:
                doc.spec === 'acquirer' && p === 'id'
                  ? 'The `redemption_id` returned by inquire'
                  : p === 'version'
                    ? 'Version number'
                    : 'Resource id (UUID)',
            }),
          ]),
        ),
      )
    : undefined;
  const headers = route.headers.includes('idempotency-key')
    ? z.object({
        'Idempotency-Key': z.string().max(128).openapi({
          description:
            'Your transaction reference; retries with the same key return the original answer',
        }),
      })
    : undefined;

  const responses: Record<string, unknown> = {};
  const contentType = doc.content ?? 'application/json';
  responses[String(route.status)] = {
    description: doc.responseDescription ?? doc.summary,
    ...(doc.responseHeaders
      ? {
          headers: Object.fromEntries(
            Object.entries(doc.responseHeaders).map(([h, v]) => [
              h,
              { ...v, schema: { type: 'string' } },
            ]),
          ),
        }
      : {}),
    ...(doc.response || contentType !== 'application/json'
      ? {
          content: {
            [contentType]: {
              schema:
                contentType === 'application/pdf'
                  ? { type: 'string', format: 'binary' }
                  : contentType === 'application/json'
                    ? doc.response
                    : { type: 'string' },
              ...(doc.responseExample ? { example: doc.responseExample } : {}),
            },
          },
        }
      : {}),
  };
  if (route.body || route.query)
    responses['400'] = err('VALIDATION_ERROR: the message lists every invalid field');
  const secured = security(doc.spec, route).some((s) => Object.keys(s).length > 0);
  if (secured && route.key !== 'GET /metrics')
    responses['401'] = err(
      doc.spec === 'acquirer'
        ? 'Missing or invalid signature, timestamp, API key or source IP'
        : 'UNAUTHORIZED: not signed in',
    );
  if (route.key === 'GET /metrics') responses['401'] = err('Metrics token required');
  if (route.roles && !ALL_ROLES.every((r) => route.roles!.includes(r)))
    responses['403'] = err('FORBIDDEN: your role does not allow this action');
  if (doc.spec === 'admin' && route.body)
    responses['415'] = err('UNSUPPORTED_MEDIA_TYPE: send application/json');
  for (const [status, description] of Object.entries(doc.errors ?? {})) {
    if (status === '503')
      responses[status] = {
        description,
        content: { 'application/json': { schema: ref('Health') } },
      };
    else responses[status] = err(description);
  }

  const description = [doc.description, rolesLine(route.roles)].filter(Boolean).join('\n\n');
  registry.registerPath({
    method: route.method,
    path,
    tags: [doc.tag],
    summary: doc.summary,
    ...(description ? { description } : {}),
    operationId:
      doc.operationId ??
      `${route.controller.replace(/Controller$/, '')}_${route.handler}`.replace(/^./, (c) =>
        c.toLowerCase(),
      ),
    security: security(doc.spec, route),
    ...(route.roles ? { 'x-roles': route.roles } : {}),
    request: {
      ...(params ? { params } : {}),
      ...(route.query ? { query: route.query as AnyZodObject } : {}),
      ...(headers ? { headers } : {}),
      ...(route.body
        ? {
            body: {
              required:
                !route.body.isOptional() &&
                !(route.body._def as { defaultValue?: unknown }).defaultValue,
              content: {
                'application/json': {
                  schema: route.body,
                  ...(doc.requestExample ? { example: doc.requestExample } : {}),
                },
              },
            },
          }
        : {}),
    },
    responses: responses as never,
  });
}

/** Builds the three OpenAPI documents. */
export function buildSpecs(): Record<SpecName, Record<string, unknown>> {
  const pairs = matchRoutes();
  const out = {} as Record<SpecName, Record<string, unknown>>;
  for (const name of ['acquirer', 'admin', 'ops'] as const) {
    const meta = SPECS[name];
    const registry = new OpenAPIRegistry();
    for (const [scheme, def] of Object.entries(meta.securitySchemes))
      registry.registerComponent('securitySchemes', scheme, def as never);
    const used = pairs.filter((p) => p.doc.spec === name);
    for (const { route, doc } of used) registerRoute(registry, route, doc);

    const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: meta.info,
      servers: meta.servers as never,
      tags: meta.tags.filter((t) => used.some((p) => p.doc.tag === t.name)),
    }) as unknown as Record<string, unknown> & {
      components?: { schemas?: Record<string, Schema> };
    };

    // Add only the component schemas this document references (transitively).
    const library: Record<string, Schema> = {
      ...enumComponents(),
      ...modelComponents(MODELS),
      ...COMPONENTS,
      SafetySettings: {
        ...(new OpenApiGeneratorV31(
          (() => {
            const r = new OpenAPIRegistry();
            r.register('SafetySettings', safetySchema);
            return r.definitions;
          })(),
        ).generateComponents().components?.schemas?.SafetySettings as Schema),
        description: 'Live safety settings, shared by every API instance.',
      },
    };
    const schemas: Record<string, Schema> = { ...(doc.components?.schemas ?? {}) };
    const pending = [JSON.stringify(doc.paths)];
    while (pending.length) {
      const text = pending.pop()!;
      for (const [, refName] of text.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)) {
        if (schemas[refName!] || !library[refName!]) continue;
        schemas[refName!] = library[refName!]!;
        pending.push(JSON.stringify(library[refName!]));
      }
    }
    delete doc.webhooks;
    fixDates(doc.paths);
    doc.components = {
      ...(doc.components ?? {}),
      schemas: Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b))),
    };
    out[name] = doc;
  }
  return out;
}

/** Markdown index of every endpoint with its roles, for quick reading in the repo. */
export function endpointIndex(): string {
  const rows = matchRoutes()
    .sort(
      (a, b) =>
        a.doc.spec.localeCompare(b.doc.spec) ||
        a.doc.tag.localeCompare(b.doc.tag) ||
        a.route.path.localeCompare(b.route.path),
    )
    .map(({ route, doc }) => {
      const who = route.isPublic
        ? 'public'
        : doc.spec === 'acquirer'
          ? 'acquirer (HMAC)'
          : route.roles
            ? rolesLine(route.roles).replace('**Roles:** ', '')
            : route.key === 'GET /metrics'
              ? 'metrics token'
              : 'none';
      return `| ${doc.spec} | ${doc.tag} | \`${route.method.toUpperCase()}\` | \`${route.path}\` | ${doc.summary} | ${who} |`;
    });
  return [
    '<!-- Generated by `pnpm --filter @instant-discount/api docs:api`. Do not edit. -->',
    '',
    '# API endpoints',
    '',
    `${rows.length} endpoints. Full request and response schemas are in the OpenAPI files next to this one.`,
    '',
    '| Spec | Area | Method | Path | What it does | Who can call it |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

const OUT_DIR = resolve(__dirname, '../../../../docs/api');
export const OUTPUT_FILES: Record<SpecName, string> = {
  acquirer: 'acquirer-v1.yaml',
  admin: 'admin-v1.yaml',
  ops: 'ops.yaml',
};

/**
 * Redoc 2 (single page, hash links), copied from the pinned `redoc` package next to the pages,
 * so the reference works from disk, offline, or on any static host without a CDN.
 */
const REDOC_BUNDLE = 'redoc/bundles/redoc.standalone.js';
const REDOC_SCRIPT = 'redoc.standalone.js';

function renderHtml(spec: Record<string, unknown>): string {
  const title = String((spec.info as { title: string }).title);
  // Embedded as JSON; escape "<" so the spec can never close the script tag.
  const json = JSON.stringify(spec).replace(/</g, '\\u003c');
  return `<!doctype html>
<!-- Generated by \`pnpm --filter @instant-discount/api docs:api\`. Do not edit. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="redoc"></div>
    <script src="${REDOC_SCRIPT}"></script>
    <script>
      Redoc.init(${json}, {
        expandResponses: '200,201',
        jsonSampleExpandLevel: 3,
        sortTagsAlphabetically: false,
        theme: { colors: { primary: { main: '#1D428A' } }, typography: { fontFamily: 'system-ui, sans-serif' } },
      }, document.getElementById('redoc'));
    </script>
  </body>
</html>
`;
}

export function renderAll(): Record<string, string> {
  const specs = buildSpecs();
  const header =
    '# Generated by `pnpm --filter @instant-discount/api docs:api`. Do not edit by hand.\n';
  const files: Record<string, string> = {};
  for (const [name, file] of Object.entries(OUTPUT_FILES))
    files[file] =
      header + stringify(specs[name as SpecName], { lineWidth: 0, aliasDuplicateObjects: false });
  for (const name of Object.keys(OUTPUT_FILES) as SpecName[])
    files[`${name}.html`] = renderHtml(specs[name]);
  files['endpoints.md'] = endpointIndex();
  files[REDOC_SCRIPT] = readFileSync(require.resolve(REDOC_BUNDLE), 'utf8');
  files[`${REDOC_SCRIPT}.LICENSE.txt`] = readFileSync(
    require.resolve(`${REDOC_BUNDLE}.LICENSE.txt`),
    'utf8',
  );
  return files;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const files = renderAll();
  const stale: string[] = [];
  for (const [file, content] of Object.entries(files)) {
    const path = join(OUT_DIR, file);
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) stale.push(file);
    } else writeFileSync(path, content);
  }
  if (stale.length) {
    console.error(
      `API docs are out of date: ${stale.join(', ')}.\nRun: pnpm --filter @instant-discount/api docs:api`,
    );
    process.exit(1);
  }
  console.log(
    check ? 'API docs are up to date.' : `Wrote ${Object.keys(files).join(', ')} to docs/api`,
  );
}
