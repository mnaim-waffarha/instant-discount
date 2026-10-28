import type { User } from '@instant-discount/db';

export function toUserDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    partnerId: u.partnerId,
    locale: u.locale,
    active: u.active,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}
