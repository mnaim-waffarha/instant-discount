import 'reflect-metadata';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import type { UserRole } from '@instant-discount/db';
import type { ZodTypeAny } from 'zod';
import { AcquirersAdminController } from '../admin/acquirers/acquirers-admin.controller';
import { AuditController } from '../admin/audit/audit.controller';
import { AuthController } from '../admin/auth/auth.controller';
import { PUBLIC_KEY, ROLES_KEY, STAFF_ROLES } from '../admin/auth/roles';
import { CampaignsController, SimulatorController } from '../admin/campaigns/campaigns.controller';
import { ExplorerController } from '../admin/explorer/explorer.controller';
import { NetworkController } from '../admin/network/network.controller';
import { PartnersController } from '../admin/partners/partners.controller';
import { UsersController } from '../admin/users/users.controller';
import { ZodPipe } from '../common/zod-pipe';
import { DiscountsController } from '../discounts/discounts.controller';
import { HealthController } from '../health.controller';
import { MetricsController, SafetyController } from '../safety/safety.controller';
import { PortalController } from '../settlement/portal.controller';
import { SettlementController } from '../settlement/settlement.controller';

/** Every HTTP controller the API mounts. A controller missing here fails the docs test. */
export const CONTROLLERS = [
  DiscountsController,
  AuthController,
  CampaignsController,
  SimulatorController,
  ExplorerController,
  NetworkController,
  PartnersController,
  AcquirersAdminController,
  UsersController,
  AuditController,
  SettlementController,
  PortalController,
  SafetyController,
  MetricsController,
  HealthController,
];

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface DiscoveredRoute {
  /** "POST /v1/discounts/inquire", the key used by the docs registry. */
  key: string;
  method: Method;
  /** Express-style path, e.g. /admin/v1/campaigns/:id */
  path: string;
  controller: string;
  handler: string;
  status: number;
  /** null = no role check (public, or a non-admin guard such as the acquirer HMAC guard). */
  roles: UserRole[] | null;
  isPublic: boolean;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  pathParams: string[];
  /** Named headers the handler reads (e.g. idempotency-key). */
  headers: string[];
  /** The handler writes the response itself (files, CSV, metrics text). */
  rawResponse: boolean;
}

const METHODS: Partial<Record<RequestMethod, Method>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

interface RouteArg {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

/** The schema a ZodPipe validates with (the pipe keeps it private). */
const schemaOf = (pipes: unknown[] = []): ZodTypeAny | undefined => {
  const pipe = pipes.find((p) => p instanceof ZodPipe) as unknown as
    { schema: ZodTypeAny } | undefined;
  return pipe?.schema;
};

/** Reads routes, roles and validation schemas from the controllers' Nest metadata. */
export function discoverRoutes(
  controllers: Array<new (...args: never[]) => unknown> = CONTROLLERS,
) {
  const routes: DiscoveredRoute[] = [];
  for (const controller of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const proto = controller.prototype as Record<string, unknown>;
    for (const handler of Object.getOwnPropertyNames(proto)) {
      const fn = proto[handler];
      if (handler === 'constructor' || typeof fn !== 'function') continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (requestMethod === undefined) continue;
      const method = METHODS[requestMethod];
      if (!method) throw new Error(`${controller.name}.${handler}: unsupported HTTP method`);

      const path = join(base, String(Reflect.getMetadata(PATH_METADATA, fn) ?? ''));
      const args = Object.entries(
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler) ?? {}) as Record<
          string,
          RouteArg
        >,
      ).map(([key, arg]) => ({ type: Number(key.split(':')[0]), ...arg }));
      const argOf = (type: RouteParamtypes) => args.find((a) => a.type === type);

      const isPublic =
        Reflect.getMetadata(PUBLIC_KEY, fn) ?? Reflect.getMetadata(PUBLIC_KEY, controller) ?? false;
      const declared = (Reflect.getMetadata(ROLES_KEY, fn) ??
        Reflect.getMetadata(ROLES_KEY, controller)) as UserRole[] | undefined;
      // Admin routes without @Roles default to staff (see AdminAuthGuard).
      const roles = isPublic
        ? null
        : (declared ?? (path.startsWith('/admin/') ? STAFF_ROLES : null));

      const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, fn) as number | undefined) ??
        (method === 'post' ? 201 : 200);

      routes.push({
        key: `${method.toUpperCase()} ${path}`,
        method,
        path,
        controller: controller.name,
        handler,
        status,
        roles,
        isPublic,
        body: schemaOf(argOf(RouteParamtypes.BODY)?.pipes),
        query: schemaOf(argOf(RouteParamtypes.QUERY)?.pipes),
        pathParams: [...path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]!),
        headers: args
          .filter((a) => a.type === RouteParamtypes.HEADERS && typeof a.data === 'string')
          .map((a) => String(a.data)),
        rawResponse:
          !!argOf(RouteParamtypes.RESPONSE) &&
          !Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, controller, handler),
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
