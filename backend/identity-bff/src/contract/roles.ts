/**
 * Administrative DIGIT role codes: roles that administer a workspace or act as
 * the platform. Linking an account (`_link`) and an admin email change
 * (`_updateEmail`) are guarded only by these, plus every other `*_ADMIN` code;
 * operational roles (GRO, CSR, PGR_LME, SUPERVISOR, …) are never checked.
 * docs/identity-bff.md §3.3 names this constant and lists the same codes;
 * tests/contract/catalogue.test.ts keeps the two identical.
 */
export const ADMINISTRATIVE_ROLES: readonly string[] = ["SUPERUSER", "INTERNAL_MICROSERVICE_ROLE", "SYSTEM", "REINDEXING_ROLE", "QA_AUTOMATION"];

export const isAdministrativeRole = (code: string): boolean => ADMINISTRATIVE_ROLES.includes(code) || code.endsWith("_ADMIN");
