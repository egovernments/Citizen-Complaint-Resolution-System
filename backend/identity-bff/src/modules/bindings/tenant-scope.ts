/**
 * D16 (amended): a root workspace `ws` (its Organization's tenant) may bind EMPLOYEE accounts whose own DIGIT
 * tenant is `ws` or a child tenant `ws.<city>`. Kong authorizes a DIGIT token against its home tenant, so such an
 * account's token is minted at the account's own tenant (`ke.nairobi`), never re-homed to `ke`.
 *
 * A tenant sharing the workspace's name as a plain prefix (`kex` for `ke`) or another root is never inside.
 */
export function withinWorkspace(tenantId: unknown, workspaceTenantId: string): boolean {
  return typeof tenantId === "string" && workspaceTenantId.length > 0 &&
    (tenantId === workspaceTenantId || tenantId.startsWith(`${workspaceTenantId}.`));
}
