// Route map for the PGR public landing page.
//
// The landing page never implements these destinations — they are the existing
// application's pages. Every CTA on the page resolves through this map, so
// integrators rebind the page to their deployment by overriding entries via
// the `routes` prop on <PGRLandingPage /> (or by editing the defaults here).
//
// Path semantics (handled by <LandingLink>):
//   - "/..."                -> in-app route: SPA navigation when a react-router
//                              v5 Router is mounted above the page, otherwise a
//                              normal anchor navigation.
//   - "https://...", "tel:", "mailto:" -> plain anchor.
//   - "#"                   -> placeholder; rendered inert (aria-disabled) so a
//                              half-configured deployment never ships a
//                              link that scrolls to top.

export interface LandingRoutes {
  /** This landing page itself (used by the logo / "Início" nav item). */
  HOME: string;
  /** Existing citizen complaint-creation flow. */
  REGISTER_COMPLAINT: string;
  /** Existing citizen complaint list / tracking page. */
  TRACK_COMPLAINT: string;
  /** Existing citizen login. */
  CITIZEN_LOGIN: string;
  /** Existing employee login. */
  EMPLOYEE_LOGIN: string;
  /** Training / help centre. */
  TRAINING: string;
  /** About-the-portal page. */
  ABOUT: string;
  /** Contacts page. */
  CONTACTS: string;
  /** FAQ page. */
  FAQ: string;
  /** Privacy policy. */
  PRIVACY: string;
  /** Terms of use. */
  TERMS: string;
  /** Accessibility statement. */
  ACCESSIBILITY: string;
  /** News / updates archive. */
  NEWS: string;
  /** Android app store listing (external). */
  ANDROID_APP: string;
  /** Official WhatsApp deep link (external). */
  WHATSAPP: string;
  /** Toll-free green line. */
  GREEN_LINE: string;
  /** Switchboard phone shown in the utility bar. */
  PHONE: string;
}

export const DEFAULT_LANDING_ROUTES: LandingRoutes = {
  // Known routes of the existing PGR application (react-router paths under the
  // app basename, e.g. /digit-ui). Verified against products/pgr/src/pages/citizen.
  HOME: "/citizen/pgr/landing",
  REGISTER_COMPLAINT: "/citizen/pgr/create-complaint",
  TRACK_COMPLAINT: "/citizen/pgr/complaints",
  CITIZEN_LOGIN: "/citizen/login",
  // NOTE: confirm the employee entry point for your deployment.
  EMPLOYEE_LOGIN: "/employee",

  // Placeholders — point these at real pages (or external CMS URLs) during
  // integration. "#" renders the control disabled rather than as a dead link.
  TRAINING: "#",
  ABOUT: "#",
  CONTACTS: "#",
  FAQ: "#",
  PRIVACY: "#",
  TERMS: "#",
  ACCESSIBILITY: "#",
  NEWS: "#",
  ANDROID_APP: "#",

  // External / telephony channels.
  // Number carried over from the approved prototype — CONFIRM the official
  // WhatsApp line before go-live (set to "#" to disable all WhatsApp CTAs
  // including the floating action).
  WHATSAPP: "https://wa.me/258820000008",
  GREEN_LINE: "tel:1490",
  PHONE: "tel:+258214900000",
};

export function mergeRoutes(overrides?: Partial<LandingRoutes>): LandingRoutes {
  return { ...DEFAULT_LANDING_ROUTES, ...overrides };
}
