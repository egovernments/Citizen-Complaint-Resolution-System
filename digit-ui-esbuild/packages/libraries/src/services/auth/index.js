import { AuthAdapter } from "./AuthAdapter";
import { getAuthProvider } from "./authSurface";

let _adapter = null;

export function getAuthAdapter() {
  if (_adapter) return _adapter;
  throw new Error("AuthAdapter not initialized. Call initAuthAdapter() first.");
}

export async function initAuthAdapter() {
  // Resolve per the current surface so the employee bundle never instantiates
  // the Keycloak adapter off a global AUTH_PROVIDER flag.
  const provider = getAuthProvider();

  if (provider === "keycloak") {
    const { KeycloakAuthAdapter } = await import("./KeycloakAuthAdapter");
    _adapter = new KeycloakAuthAdapter();
  } else {
    const { DigitAuthAdapter } = await import("./DigitAuthAdapter");
    _adapter = new DigitAuthAdapter();
  }

  await _adapter.init();
  return _adapter;
}

export { AuthAdapter };
