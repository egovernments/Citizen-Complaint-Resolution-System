/**
 * Reading DIGIT's error envelope, for tests that assert a request is REFUSED.
 *
 * Every DIGIT service answers a rejected request with the same shape —
 * `{ "Errors": [ { "code": "...", "message": "..." } ] }` — but the suite has no
 * shared way to read it. Five specs hand-roll the same
 * `(await r.json()).Errors?.[0]?.code` dance today
 * (`admin/localization.spec.ts`, `admin/boundary-hierarchies.spec.ts`,
 * `admin/recently-shipped-fixes.spec.ts`, `admin/configurator-mdms-fixes-2026-04-29.spec.ts`,
 * `api/filestore-fixes-2026-04-29.spec.ts`), each with a different idea of what to
 * print when the assertion fails — which is exactly when you need the body.
 *
 * Deliberately NOT the inverse of the per-spec `assertOk()` helpers: those throw
 * on a non-2xx, consuming the body before the code can be read, so they cannot
 * express "this must fail, and fail for THIS reason". A test that settles for
 * `expect(resp.ok).toBe(false)` passes for the wrong reason just as readily —
 * a 401 from an expired token, a 400 from a malformed payload, a 404 from a typo
 * in the path all look identical to it. Naming the code is what makes a negative
 * assertion mean something.
 *
 * Module-agnostic on purpose: nothing here knows about PGR, MDMS or HRMS.
 */

export interface ApiErrorReport {
  /** HTTP status actually returned. */
  status: number;
  /** Every `code` in `Errors[]`, in order. Empty when the envelope had none. */
  codes: string[];
  /** Every `message` in `Errors[]`, in order. */
  messages: string[];
  /** The parsed body, or `{ _raw: '…' }` when it was not JSON. */
  body: any;
}

/** Read the error envelope without asserting anything. Consumes the body. */
export async function readApiErrors(resp: Response): Promise<ApiErrorReport> {
  const text = await resp.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Gateways answer with HTML on their own failures (502/504 pages). Keep a
    // slice rather than throwing: the caller's assertion message is the only
    // place this will ever be read, and a truncated page still identifies it.
    body = { _raw: text.slice(0, 600) };
  }
  const errors: any[] = Array.isArray(body?.Errors) ? body.Errors : [];
  return {
    status: resp.status,
    codes: errors.map((e) => String(e?.code ?? '')).filter(Boolean),
    messages: errors.map((e) => String(e?.message ?? '')).filter(Boolean),
    body,
  };
}

/**
 * Assert a request was refused, and refused for the named reason.
 *
 * `expected` accepts:
 *  - a string — matched exactly against any code in `Errors[]`
 *  - a RegExp — for codes with a variable tail (`typeMismatch.…`)
 *  - an array of strings — any one of them matching is a pass, for a guard whose
 *    code legitimately differs by deployment configuration
 *
 * Throws with the status and the whole envelope on failure, because "expected
 * ESCALATION_MAX_DEPTH, got ESCALATION_NO_ASSIGNEE" is the single most useful
 * line when a negative test starts failing.
 */
export async function expectApiError(
  resp: Response,
  expected: string | RegExp | readonly string[],
  context: string,
): Promise<ApiErrorReport> {
  const report = await readApiErrors(resp);
  const describe = () =>
    `HTTP ${report.status}; codes=${JSON.stringify(report.codes)}; body=${JSON.stringify(report.body).slice(0, 500)}`;

  // A 2xx here means the operation SUCCEEDED, which for a negative test is the
  // failure mode worth shouting about — the guard under test did not fire, and
  // on a shared deployment the call has probably just mutated live data.
  if (resp.ok) {
    throw new Error(`${context}: expected the request to be refused, but it succeeded — ${describe()}`);
  }

  const matched = Array.isArray(expected)
    ? report.codes.some((c) => (expected as readonly string[]).includes(c))
    : expected instanceof RegExp
      ? report.codes.some((c) => expected.test(c))
      : report.codes.includes(expected as string);

  if (!matched) {
    const want = Array.isArray(expected)
      ? `one of ${JSON.stringify(expected)}`
      : expected instanceof RegExp
        ? String(expected)
        : `'${String(expected)}'`;
    throw new Error(`${context}: refused as expected, but for the wrong reason — wanted ${want}; got ${describe()}`);
  }

  return report;
}
