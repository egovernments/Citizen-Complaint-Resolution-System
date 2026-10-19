import { ERROR_CODES, type HttpErrorCode } from "../../contract/error-codes.js";

export type BindingActor =
  | { kind: "browser"; subject: string; requestId: string }
  | { kind: "workload"; operationId: string; restartNo: number }
  | { kind: "migration" };

export interface Binding {
  tenantId: string;
  uuid: string;
  /** The normalized address `_link` used for this invitationVersion (absent for _ensure/conversion and older records). */
  email?: string;
  state: "pending" | "active" | "removed";
  invitationVersion: number;
  createdAt: number;
  createdBy: Exclude<BindingActor, { kind: "migration" }> | { kind: "conversion" };
  expiresAt?: number;
  acceptedAt?: number;
  boundAt?: number;
  removedAt?: number;
  removedBy?: { kind: "browser" | "expiry" | "operator"; subject?: string };
}

export type { UserRepresentation as BindingUser } from "../sync/keycloak-writer.js";

export class BindingError extends Error {
  readonly status: number;
  constructor(readonly code: HttpErrorCode, message: string) {
    super(message);
    this.status = ERROR_CODES[code].status;
  }
}

export class BindingConflictError extends BindingError {
  constructor() { super("BINDING_CONFLICT", "This person already has another account at the workspace"); }
}
