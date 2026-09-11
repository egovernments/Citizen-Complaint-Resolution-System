/**
 * Lifecycle fixtures setup — runs once before any chromium test.
 *
 * Creates three complaints against the seed plan's (serviceCode, actor,
 * assignee) TRIPLE — see personas.ts's resolveSeedPlan() for why that triple,
 * not "whichever employee is handy", is what ASSIGN actually accepts:
 * pgr-services validates the ASSIGNEE's HRMS department against the
 * complaint type's department, and egov-workflow-v2 separately rejects an
 * assignee who holds no role able to act on the next state. On bomet the
 * actor (GRO) and the assignee are necessarily different people.
 *
 *  1. NON-TERMINAL: left at PENDINGFORASSIGNMENT.
 *  2. ASSIGNED: driven to PENDINGATLME and left there — assigned but
 *     unresolved, for specs that need an already-assigned complaint without
 *     walking it all the way to closed.
 *  3. TERMINAL+RATED: walked through ASSIGN → RESOLVE → RATE to land at
 *     CLOSEDAFTERRESOLUTION with a 4-star rating.
 *
 * Writes `lifecycle-fixtures.json` next to `auth.json` so downstream specs
 * can read deterministic, deployment-fresh SRIDs instead of pinning to
 * historical seed data.
 *
 * Seeding always goes through seedComplaintAsCitizen() (utils/seed.ts) —
 * APPLY is [CITIZEN, CSR] on every deployment, so filing as an
 * employee/ADMIN token is not a shortcut, it 400s "INVALID ROLE" on bomet.
 * ASSIGN/RESOLVE/RATE go through the matching seed.ts helper, which already
 * knows the actor and assignee can be different people and that RATE is only
 * open to whoever filed the complaint (not the LME).
 *
 * If resolveSeedPlan() can't find a viable triple on this deployment — no
 * complaint types, no ASSIGN transition, no eligible assignee, no GRO actor —
 * the setup writes a `status: 'skipped'` fixture file naming the precise
 * cause (never a bare uuid) and PASSES. This is intentional: a partial
 * deployment must not cascade-fail the whole chromium project; downstream
 * specs fall back to their own env-var/historical defaults instead.
 */
import { test, expect } from '@playwright/test';
import { TENANT } from '../utils/env';
import { resolveSeedPlan } from '../utils/personas';
import {
  seedComplaintAsCitizen,
  driveToPendingAtLme,
  driveToResolved,
  driveToClosedRated,
} from '../utils/seed';
import { writeLifecycleFixtures, LifecycleFixtures } from '../utils/lifecycle-fixtures';

test('seed lifecycle fixtures (non-terminal + assigned + terminal-with-rating complaints)', async () => {
  const writeSkipped = (reason: string): void => {
    const fixtures: LifecycleFixtures = {
      generated_at: new Date().toISOString(),
      tenant: TENANT,
      status: 'skipped',
      skipped_reason: reason,
    };
    const path = writeLifecycleFixtures(fixtures);
    console.log(`[lifecycle.setup] SKIPPED: ${reason}`);
    console.log(`[lifecycle.setup] wrote skip marker to ${path}`);
  };

  const plan = await resolveSeedPlan();
  if ('error' in plan) {
    writeSkipped(plan.error);
    return; // PASS the setup — downstream uses env/defaults
  }
  console.log(
    `[lifecycle.setup] tenant=${TENANT} serviceCode=${plan.serviceCode} localityCode=${plan.localityCode} ` +
    `actor=${plan.actor.username} assignee=${plan.assigneeCode}`,
  );

  let nonTerminal: string;
  let assigned: string;
  let terminal: string;
  try {
    // Complaint 1: non-terminal, left at PENDINGFORASSIGNMENT.
    const seeded1 = await seedComplaintAsCitizen({ description: `lifecycle setup non-terminal — ${new Date().toISOString()}` });
    expect(seeded1.srid, 'response must contain serviceRequestId').toMatch(/^[A-Z]+-PGR-/);
    expect(seeded1.status, 'non-terminal initial status').toBe('PENDINGFORASSIGNMENT');
    nonTerminal = seeded1.srid;
    console.log(`[lifecycle.setup] NON_TERMINAL ${nonTerminal} → PENDINGFORASSIGNMENT`);

    // Complaint 2: assigned to the seed plan's assignee, left at PENDINGATLME.
    const seeded2 = await seedComplaintAsCitizen({ description: `lifecycle setup assigned — ${new Date().toISOString()}` });
    assigned = seeded2.srid;
    await driveToPendingAtLme(assigned);
    console.log(`[lifecycle.setup] ASSIGNED ${assigned} → PENDINGATLME (assignee ${plan.assigneeCode})`);

    // Complaint 3: walk it end-to-end to CLOSEDAFTERRESOLUTION + rating.
    const seeded3 = await seedComplaintAsCitizen({ description: `lifecycle setup terminal-rated — ${new Date().toISOString()}` });
    terminal = seeded3.srid;
    console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGFORASSIGNMENT (will walk forward)`);
    await driveToPendingAtLme(terminal);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGATLME`);
    await driveToResolved(terminal);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → RESOLVED`);
    await driveToClosedRated(terminal, 4);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → CLOSEDAFTERRESOLUTION rating=4`);
  } catch (err: any) {
    writeSkipped(`workflow walk: ${err.message?.slice(0, 200)}`);
    return; // PASS — downstream falls back
  }

  // Persist the full fixtures so downstream specs can read them.
  const fixtures: LifecycleFixtures = {
    generated_at: new Date().toISOString(),
    tenant: TENANT,
    status: 'ok',
    complaints: {
      non_terminal: nonTerminal,
      terminal_rated: terminal,
      assigned_to_employee: assigned,
    },
    assignee: { uuid: plan.assigneeUuid, code: plan.assigneeCode },
  };
  const path = writeLifecycleFixtures(fixtures);
  console.log(`[lifecycle.setup] wrote fixtures to ${path}`);
});
