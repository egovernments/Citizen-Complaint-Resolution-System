/**
 * When an access change reaches the person: ONE place, used by every save and grant confirmation in the access
 * screens (PM 2026-10-13: "say plainly when it takes effect"). Each value names its source and the measurement that
 * backs it (demo runs on staging-2, 2026-10-12, tests/configurator-access/demo-subcounty-gro.spec.ts). When a cache
 * changes (cms-access is shortening the gateway's), change the number here and the sentences follow.
 */
export const EFFECT = {
  /** HRMS areas: pgr reads the person's jurisdictions from HRMS on each search. Measured 21 s (run ACBSV, area move). */
  areasSeconds: 30,
  /** Role-actions (what a role may call): keycloak-rbac caches each decision per gateway worker for 300 s
   *  (kong.v3.compat.yml keycloak-rbac cache_ttl) after gateway-rules-sync (~30 s). Measured: refused from 302 s,
   *  consistently from 310 s (ACBSV (a)); a new role's first inbox view 355 s (a denial cached before the sync). */
  gatewaySeconds: 330,
  /** Which complaints / which fields (action 2008's scope and field rules): pgr's AccessPolicyRegistry caches the rows
   *  60 s (pgr.access-policy-actions / -urls, cfgprop class 4, #1504; was 15 min). Measured before #1504: Hide reached
   *  pgr's answer after 249 s (ACBSV (c)) under the 15-min TTL. */
  policySeconds: 60,
  /** A role granted or removed: it is in the person's sign-in token, so it applies at their next sign-in or token
   *  refresh (access-token lifespan: 300 s compose / 900 s realm export). Measured: a fresh sign-in carried it at once. */
  tokenSeconds: 900,
  /** After the save asked pgr to refresh (cms-access #1504, POST /pgr-services/v2/access/_refresh): its policy cache is
   *  cleared at once and kept at most this long as a backstop. To be confirmed by cms-access's staging-2 probe (v3
   *  MDMS's own read cache may still delay a change). */
  refreshedPolicySeconds: 60,
};

const human = (s: number) => (s < 90 ? `about ${Math.max(10, Math.round(s / 10) * 10)} seconds` : `within ${Math.ceil(s / 60)} minutes`);

export type ChangeKind = 'areas' | 'calls' | 'scope' | 'fields' | 'workflow' | 'grant';

/** The sentence for one kind of change, as the confirmation shows it. */
export function whenItApplies(kind: ChangeKind, refreshed = false): string {
  const policy = refreshed ? EFFECT.refreshedPolicySeconds : EFFECT.policySeconds;
  switch (kind) {
    case 'areas': return `Area changes apply to the person's searches ${human(EFFECT.areasSeconds)}.`;
    case 'calls': return `What the role may do applies ${human(EFFECT.gatewaySeconds)} (the gateway remembers each decision for a while). Menus and buttons update when the person reloads the page; no sign-out needed.`;
    case 'scope': return `Which complaints the role sees applies ${human(policy)}${refreshed ? '' : ' (the complaint service refreshes its copy of the rules)'}.`;
    case 'fields': return `Which fields the role sees applies ${human(policy)}.`;
    case 'workflow': return `Workflow actions change what the app offers when the person reloads the complaint.`;
    case 'grant': return `A role given or taken away applies at the person's next sign-in, or ${human(EFFECT.tokenSeconds)} when their session refreshes. Area changes apply ${human(EFFECT.areasSeconds)}.`;
  }
}

/** The sentences for a save, one per kind it touches, in a fixed order. */
export function whenItAppliesAll(kinds: Iterable<ChangeKind>, refreshed = false): string[] {
  const order: ChangeKind[] = ['grant', 'areas', 'calls', 'scope', 'fields', 'workflow'];
  const set = new Set(kinds);
  return order.filter((k) => set.has(k)).map((k) => whenItApplies(k, refreshed));
}
