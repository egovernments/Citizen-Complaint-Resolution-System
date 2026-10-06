import type express from "express";
import { errorBody, errorStatus, type HttpErrorCode } from "../contract/error-codes.js";

export function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

/** The JSON error envelope with its catalogue status; busy codes carry Retry-After. */
export function sendError(response: express.Response, code: HttpErrorCode, message: string) {
  if (code === "IDENTITY_BUSY" || code === "BINDING_BUSY") response.setHeader("Retry-After", "1");
  return response.status(errorStatus(code)).json(errorBody(code, message));
}
