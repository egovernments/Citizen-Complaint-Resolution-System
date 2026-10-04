import { AuthAdapter } from "./AuthAdapter";

let _adapter = null;

export function getAuthAdapter() {
  if (_adapter) return _adapter;
  throw new Error("AuthAdapter not initialized. Call initAuthAdapter() first.");
}

export async function initAuthAdapter() {
  const { DigitAuthAdapter } = await import("./DigitAuthAdapter");
  _adapter = new DigitAuthAdapter();

  await _adapter.init();
  return _adapter;
}

export { AuthAdapter };
