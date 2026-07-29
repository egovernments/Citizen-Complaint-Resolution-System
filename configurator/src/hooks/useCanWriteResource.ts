import { usePermissions } from 'ra-core';
import { getResourceConfig } from '@/providers/bridge';

/** Can the logged-in user write (create/edit) this resource?
 *
 *  Reads the registry's optional `writeRoles` (CCSD-1998 — e.g. the
 *  Encryption Policy master is restricted to MDMS_ADMIN/SUPERUSER).
 *  Resources without `writeRoles` are writable by anyone who can log in,
 *  exactly as before. UX gate only — the server-side authority is the
 *  ACCESSCONTROL role-action mapping.
 *
 *  While permissions are still resolving, gated resources report `false`
 *  (buttons appear once roles load) — fail-closed, never fail-open. */
export function useCanWriteResource(resource: string): boolean {
  const { permissions } = usePermissions();
  const writeRoles = getResourceConfig(resource)?.writeRoles;
  if (!writeRoles?.length) return true;
  const roles: string[] = Array.isArray(permissions) ? permissions : [];
  return writeRoles.some((r) => roles.includes(r));
}
