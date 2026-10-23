import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { enterWorkspace } from '@/identity/entry';

/**
 * ours (#1954, #1945): work at another tenant AND land on a given screen there. A tenant switch (the header's, or
 * identity's contexts/_select) reloads the app on /manage; the screen to open afterwards is remembered for one load.
 */
const KEY = 'configurator:after-switch';

/** Remember where to land once the tenant switch has reloaded /manage (one shot). */
export function rememberLanding(path: string): void {
  try { sessionStorage.setItem(KEY, path); } catch { /* storage blocked: the switch lands on /manage */ }
}

/** The remembered landing, consumed; only a /manage path is honoured. */
export function takeLanding(): string | null {
  try {
    const p = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return p && /^\/manage\//.test(p) ? p : null;
  } catch { return null; }
}

/**
 * Switch to `tenant` and open `path` there: with an identity session, contexts/_select gives that tenant's own session
 * context (as the header switcher does); otherwise, or if identity refuses, the local session moves (`switchTenant`).
 */
export function openAtTenant(tenant: string, path: string, switchTenant: (code: string) => void): void {
  rememberLanding(path);
  enterWorkspace(tenant).catch(() => switchTenant(tenant));
}

/** Mounted once in the layout: after such a switch, open the remembered screen. */
export function AfterSwitchLanding() {
  const navigate = useNavigate();
  useEffect(() => {
    const p = takeLanding();
    if (p) navigate(p, { replace: true });
  }, [navigate]);
  return null;
}
