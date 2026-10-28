import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@instant-discount/db';

export const STAFF_ROLES: UserRole[] = [
  'ADMIN',
  'CAMPAIGN_MANAGER',
  'APPROVER',
  'FINANCE',
  'VIEWER',
];

export const ROLES_KEY = 'roles';
/** Restricts a route to these roles. Without it, admin routes allow any staff role. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const PUBLIC_KEY = 'public';
/** Skips session authentication (login endpoints). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Roles that may change campaigns, partners and the merchant network. */
export const EDITORS: UserRole[] = ['ADMIN', 'CAMPAIGN_MANAGER'];
export const APPROVERS: UserRole[] = ['ADMIN', 'APPROVER'];
