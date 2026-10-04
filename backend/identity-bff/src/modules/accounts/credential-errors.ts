/** OAuth descriptions are classified, never retained: unknown text can contain PII. */
export type StaffLoginFailure = "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "ACCOUNT_INACTIVE" | "DEPENDENCY";

export class StaffLoginError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(readonly reason: StaffLoginFailure, message = "DIGIT staff login failed") {
    super(message);
    this.status = reason === "ACCOUNT_LOCKED" || reason === "ACCOUNT_INACTIVE" ? 403 : 503;
    this.code = reason === "ACCOUNT_INACTIVE" ? "DIGIT_ACCOUNT_INACTIVE"
      : reason === "ACCOUNT_LOCKED" ? "ACCOUNT_LOCKED" : "DIGIT_UNAVAILABLE";
  }
}
