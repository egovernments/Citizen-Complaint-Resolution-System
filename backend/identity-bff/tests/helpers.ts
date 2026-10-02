export { signJwt, getIssuer } from "../mocks/jwks-server.js";

export function makeAuthHeader(token: string) {
  return `Bearer ${token}`;
}
