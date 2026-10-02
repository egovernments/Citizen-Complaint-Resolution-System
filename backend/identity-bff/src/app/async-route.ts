import type express from "express";

export function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}
