import { errorStatus, type HttpErrorCode } from "../../contract/error-codes.js";

export class OnboardingError extends Error {
  readonly status: number;
  constructor(readonly code: HttpErrorCode, message: string) {
    super(message);
    this.status = errorStatus(code);
  }
}
