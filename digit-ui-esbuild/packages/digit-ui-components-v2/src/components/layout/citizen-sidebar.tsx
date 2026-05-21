/* eslint-disable @typescript-eslint/no-explicit-any */
// Citizen sidebar — v2 (TypeScript + Tailwind).
//
// Replaces the legacy `<StaticCitizenSideBar>` end-to-end so the citizen
// nav rail no longer needs CSS patches in overrides.css. Same data
// (UserService, MDMS link data, helpline number) drives the rendering;
// the markup is a clean accessible <aside> with one row per nav target.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useHistory } from "react-router-dom";
import { Home, Pencil, LogOut, Phone, AlertOctagon, LogIn } from "lucide-react";
import { cn } from "../../lib/cn";

declare const Digit: any;
declare const window: any;

type ItemKind = "link" | "external" | "action";

interface NavItem {
  kind: ItemKind;
  /** Lucide icon. Optional — falls back to AlertOctagon if a tenant link
   *  doesn't carry an icon. */
  Icon?: React.ComponentType<{ className?: string }>;
  text: React.ReactNode;
  link?: string;
  onClick?: () => void;
  /**
   * Path prefixes that count as "active" for this row. Lets a single
   * sidebar entry stay highlighted across a whole module surface — e.g.
   * the Citizen Complaint row sits on /citizen/pgr-home but should stay
   * lit while the user is on /citizen/pgr/complaints or /citizen/pgr/
   * create-complaint. When omitted, falls back to exact-match on `link`.
   */
  matchPrefixes?: string[];
}

interface ProfileInfo {
  name?: string;
  mobileNumber?: string;
  emailId?: string;
}

export interface CitizenSidebarProps {
  /** MDMS-driven link blocks for tenant modules (e.g. Citizen Complaint Resolution). */
  linkData?: Record<string, Array<{ sidebar?: string; sidebarURL?: string; leftIcon?: string }>> | null;
  /** Skeleton suppression while link data loads. */
  isLoading?: boolean;
  /** Defaults to `window.contextPath`. Exposed for tests / non-default mounts. */
  contextPath?: string;
}

function Avatar({ name }: { name?: string }) {
  const initial = (name || "").trim().charAt(0).toUpperCase() || null;
  // Inline sizing so the avatar still renders even if the v2 Tailwind
  // build hasn't compiled `h-20 w-20`. The colour pulls from a neutral
  // theme var so it tints with the tenant palette.
  return (
    <div
      style={{
        display: "flex",
        height: "5rem",
        width: "5rem",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "9999px",
        // Avatar disc — translucent white over whatever sidebar bg
        // the tenant ships, with the initial drawn in the same colour
        // as the sidebar bg so the chip reads as a "negative space"
        // version of the sidebar. The 92% rgba is a design constant
        // (like the border radius), not a brand colour, so it doesn't
        // need a tenant theme variable. The initial colour is driven
        // by the existing `--color-sidebar-bg` token.
        backgroundColor: "rgba(255, 255, 255, 0.92)",
        color: "var(--color-sidebar-bg, var(--color-primary-1, #204F37))",
        flexShrink: 0,
      }}
      aria-hidden
    >
      {initial ? (
        <span style={{ fontSize: "1.75rem", fontWeight: 600 }}>{initial}</span>
      ) : (
        <svg viewBox="0 0 80 80" fill="currentColor" style={{ height: "3rem", width: "3rem", opacity: 0.4 }}>
          <circle cx="40" cy="32" r="14" />
          <path d="M12 70c0-15 13-24 28-24s28 9 28 24" />
        </svg>
      )}
    </div>
  );
}

/**
 * Single row component used for every sidebar entry — links, external
 * links, and action buttons all render through here so they share exact
 * typography, padding, hover, and active treatment. Browser default
 * button chrome (font, padding, border, background) is reset to inherit
 * so a `<button>` row visually matches a `<Link>` row pixel-for-pixel.
 */
function SidebarRow({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.Icon;
  // Bulletproof reset so a `<button>` row is pixel-identical to a `<Link>`
  // row regardless of browser defaults. Every property the user-agent might
  // disagree on is set explicitly.
  const baseStyle: React.CSSProperties = {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "6px 12px",
    minHeight: "36px",
    width: "100%",
    boxSizing: "border-box",
    borderRadius: "6px",
    transition: "background-color 0.15s ease-out",
    textDecoration: "none",
    backgroundColor: isActive
      ? "var(--color-sidebar-selected-bg, var(--color-primary-1, #c84c0e))"
      : "transparent",
    cursor: "pointer",
    border: 0,
    margin: 0,
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    fontStyle: "inherit",
    lineHeight: "inherit",
    letterSpacing: "inherit",
    textTransform: "none",
    // Drive icon + label color from the outer button so hover/active
    // cascade through `currentColor` without per-element overrides.
    color: isActive
      ? "var(--color-sidebar-selected-text, #FFFFFF)"
      : "var(--color-sidebar-text-default, #D1D5DB)",
    textAlign: "left",
    outline: "none",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };

  const handleEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (!isActive) {
      // Hover lights the row up with the tenant's hover token (a soft
      // yellow on naipepea: #FFF4D6) and flips the text/icon color to
      // the dark sidebar bg colour so it reads strongly against the
      // pale hover surface. Falls back gracefully on tenants that
      // haven't set a hover token.
      const el = e.currentTarget as HTMLElement;
      el.style.backgroundColor =
        "var(--color-sidebar-hover-bg, var(--color-primary-selected-bg, #FFF4D6))";
      el.style.color =
        "var(--color-sidebar-hover-text, var(--color-sidebar-bg, var(--color-primary-1, #204F37)))";
    }
  };
  const handleLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (!isActive) {
      const el = e.currentTarget as HTMLElement;
      el.style.backgroundColor = "transparent";
      el.style.color = "var(--color-sidebar-text-default, #D1D5DB)";
    }
  };

  const inner = (
    <>
      {isActive ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: "0 3px 3px 0",
            backgroundColor:
              "var(--color-sidebar-selected-text, #FFFFFF)",
          }}
        />
      ) : null}
      {Icon ? (
        <Icon
          className="h-5 w-5 flex-shrink-0"
          // currentColor → inherits the row's `color`, which already
          // varies by active/hover/idle state (set on the outer
          // <button>/<a>/<Link>). One source of truth.
          style={{ color: "currentColor" }}
        />
      ) : null}
      <span
        className="flex-1"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
          lineHeight: 1.25,
          fontSize: "0.875rem",
          fontWeight: isActive ? 600 : 500,
          // Inherit from outer button — driven by isActive / hover state.
          color: "inherit",
        }}
      >
        {item.text}
      </span>
    </>
  );

  // The className is critical. overrides.css ships two `:not([class])`
  // button rules with !important — one (~line 1129) styles classless
  // text-buttons as yellow primary CTAs, the other (~line 1155) styles
  // classless buttons with an svg child as bare icon-buttons (`padding:0
  // !important; background:transparent !important`). Our SidebarRow
  // buttons have a Lucide svg as a direct child, so they hit the
  // icon-button branch — that's why their padding collapsed and they
  // looked nothing like the Link rows above (which aren't selected by
  // either rule). Adding any non-empty class breaks `:not([class])` and
  // makes the row inherit only the inline baseStyle. Same class on
  // Link / <a> for symmetry.
  const sharedHandlers = {
    onMouseEnter: handleEnter,
    onMouseLeave: handleLeave,
    style: baseStyle,
    className: "v2-sidebar-row",
  };

  if (item.kind === "link" && item.link) {
    return (
      <Link to={item.link} onClick={item.onClick} {...sharedHandlers}>
        {inner}
      </Link>
    );
  }
  if (item.kind === "external" && item.link) {
    return (
      <a href={item.link} {...sharedHandlers}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={item.onClick} {...sharedHandlers}>
      {inner}
    </button>
  );
}

function Profile({ info }: { info: ProfileInfo }) {
  // Mirror the legacy StaticCitizenSideBar exactly: show the name line
  // only when info.name is present and isn't a duplicate of the mobile
  // number (some tenants store the phone in both fields).
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        padding: "20px 16px 16px 16px",
        textAlign: "center",
        borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
      }}
    >
      <Avatar name={info?.name} />
      {info?.name && info?.name !== info?.mobileNumber ? (
        <div
          style={{
            marginTop: "8px",
            fontSize: "0.875rem",
            fontWeight: 600,
            lineHeight: 1.35,
            // Same tenant token the rest of the sidebar text uses —
            // hierarchy is given by font-weight (600 here vs 400 on
            // the contact lines below) rather than colour. `--color-
            // sidebar-text-default` is the documented configurator
            // token for "default text on the sidebar surface".
            color: "var(--color-sidebar-text-default, #D1D5DB)",
          }}
        >
          {info.name}
        </div>
      ) : null}
      {info?.mobileNumber ? (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--color-sidebar-text-default, #D1D5DB)",
          }}
        >
          {info.mobileNumber}
        </div>
      ) : null}
      {info?.emailId ? (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--color-sidebar-text-default, #D1D5DB)",
          }}
        >
          {info.emailId}
        </div>
      ) : null}
    </div>
  );
}

// Hide on mobile (<768px). Tailwind's `hidden md:flex` is also applied for
// belt-and-braces, but we additionally early-return so the heavy nav
// component doesn't even mount on small viewports — the legacy mobile
// hamburger + drawer in the topbar is unaffected.
function useIsDesktop(breakpointPx = 768) {
  const [isDesktop, setIsDesktop] = React.useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= breakpointPx
  );
  React.useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= breakpointPx);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpointPx]);
  return isDesktop;
}

/**
 * Lightweight v2 confirmation modal (used for Logout). No portal — sits
 * at the sidebar's component tree root, so it inherits the v2 theme
 * tokens and Tailwind classes without extra wiring.
 */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(11, 12, 12, 0.5)",
        padding: "16px",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor:
            "var(--v2-surface-color, var(--color-surface, #ffffff))",
          borderRadius: "10px",
          boxShadow:
            "0 20px 25px -5px rgba(16, 24, 40, 0.18), 0 8px 10px -6px rgba(16, 24, 40, 0.12)",
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1.125rem",
            fontWeight: 700,
            color:
              "var(--color-primary-1, var(--color-primary-main, #c84c0e))",
          }}
        >
          {title}
        </h2>
        {body ? (
          <div
            style={{
              fontSize: "0.875rem",
              color: "var(--color-text-secondary, #6B7280)",
              lineHeight: 1.5,
            }}
          >
            {body}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "8px",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="v2-dialog-btn v2-dialog-cancel"
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              border: "1px solid var(--color-border, #d6d5d4)",
              backgroundColor: "transparent",
              color: "var(--color-text-heading, #363636)",
              fontWeight: 500,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="v2-dialog-btn v2-dialog-confirm"
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              border: 0,
              backgroundColor:
                "var(--color-button-primary-bg-default, var(--color-primary-2, #FEC931))",
              color: "var(--color-text-primary, #0B0C0C)",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CitizenSidebar({
  linkData,
  isLoading,
  contextPath: cp,
}: CitizenSidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const history = useHistory();
  const isDesktop = useIsDesktop();
  const [logoutOpen, setLogoutOpen] = React.useState(false);

  const contextPath = cp ?? window?.contextPath ?? "digit-ui";
  const user = Digit?.UserService?.getUser?.();
  const { data: storeData } = Digit?.Hooks?.useStore?.getInitData?.() ?? { data: undefined };
  const tenantId = Digit?.ULBService?.getCurrentTenantId?.();
  const tenants: any[] = storeData?.tenants ?? [];
  const helplineNumber =
    (tenants.find((tnt) => tnt.code === tenantId) ?? tenants[0])?.contactNumber;

  // Module links from MDMS (e.g. Citizen Complaint Resolution).
  const moduleLinks: NavItem[] = React.useMemo(() => {
    if (!linkData) return [];
    return Object.keys(linkData)
      .sort((a, b) => b.localeCompare(a))
      .flatMap((key) => {
        const entry = linkData[key]?.[0];
        if (!entry || entry.sidebar !== `${contextPath}-links`) return [];
        const isInternal = !!entry.sidebarURL?.includes(contextPath);
        // Derive a path prefix that covers the whole module surface, not
        // just the landing page. The MDMS-driven sidebarURL is typically
        // `/<contextPath>/citizen/<module>-home`; strip the `-home`
        // suffix so the row stays highlighted on any /<module>/* route
        // (file a complaint, complaints list, complaint detail, …).
        const prefix = entry.sidebarURL?.replace(/-home$/, "");
        return [
          {
            kind: isInternal ? ("link" as ItemKind) : ("external" as ItemKind),
            Icon: AlertOctagon,
            text: t(
              `ACTION_TEST_${Digit?.Utils?.locale?.getTransformedLocale?.(key) ?? key}`
            ),
            link: entry.sidebarURL,
            matchPrefixes: prefix ? [prefix] : undefined,
          },
        ];
      });
  }, [linkData, contextPath, t]);

  const isLoggedInCitizen = !!user?.access_token && user?.info?.type === "CITIZEN";

  const items: NavItem[] = React.useMemo(() => {
    if (isLoggedInCitizen) {
      return [
        {
          kind: "link",
          Icon: Home,
          text: t("COMMON_BOTTOM_NAVIGATION_HOME"),
          link: `/${contextPath}/citizen/all-services`,
          // Only match the all-services surface itself; using the bare
          // `/citizen` prefix would steal the active state from every
          // module surface (e.g. /citizen/pgr-home would light Home up
          // instead of Citizen Complaint).
          matchPrefixes: [`/${contextPath}/citizen/all-services`],
        },
        ...moduleLinks,
        {
          kind: "link",
          Icon: Pencil,
          text: t("EDIT_PROFILE"),
          link: `/${contextPath}/citizen/user/profile`,
          matchPrefixes: [`/${contextPath}/citizen/user/profile`],
        },
        {
          kind: "action",
          Icon: LogOut,
          text: t("CORE_COMMON_LOGOUT"),
          // Open the v2 confirm modal — the legacy LogoutDialog the
          // citizen sidebar used to spawn was lost in the v2 rewrite.
          // The actual `Digit.UserService.logout()` call lives in the
          // dialog's onConfirm so the user can still back out.
          onClick: () => setLogoutOpen(true),
        },
        {
          kind: "action",
          Icon: Phone,
          // Tap anywhere on the row → dial the helpline. Previously
          // only the inner `<a tel:>` anchor was actionable; clicking
          // the rest of the row did nothing (CCRS#557). The visible
          // number stays underlined so the user knows what's being
          // called. Falls back to a static label when the tenant has
          // no helpline configured.
          onClick: helplineNumber
            ? () => {
                window.location.href = `tel:${helplineNumber}`;
              }
            : undefined,
          text: (
            <span className="flex flex-col items-start gap-0.5">
              <span>{t("CS_COMMON_HELPLINE")}</span>
              {helplineNumber ? (
                <span
                  className="text-xs"
                  style={{
                    color: "inherit",
                    textDecoration: "underline",
                    textDecorationColor: "currentColor",
                    opacity: 0.85,
                  }}
                >
                  {helplineNumber}
                </span>
              ) : null}
            </span>
          ),
        },
      ];
    }
    return [
      ...moduleLinks,
      {
        kind: "action",
        Icon: LogIn,
        text: t("CORE_COMMON_LOGIN"),
        onClick: () => history.push(`/${contextPath}/citizen/login`),
      },
      {
        kind: "action",
        Icon: Phone,
        // Same tel: dial behaviour for the logged-out branch when a
        // helpline is configured. Without it the row was a dead action
        // (CCRS#557).
        onClick: helplineNumber
          ? () => {
              window.location.href = `tel:${helplineNumber}`;
            }
          : undefined,
        text: helplineNumber ? (
          <span className="flex flex-col items-start gap-0.5">
            <span>{t("CS_COMMON_HELPLINE")}</span>
            <span
              className="text-xs"
              style={{
                color: "inherit",
                textDecoration: "underline",
                textDecorationColor: "currentColor",
                opacity: 0.85,
              }}
            >
              {helplineNumber}
            </span>
          </span>
        ) : (
          t("CS_COMMON_HELPLINE")
        ),
      },
    ];
  }, [isLoggedInCitizen, t, history, contextPath, moduleLinks, helplineNumber]);

  if (!isDesktop) return null;

  if (isLoading) {
    return (
      <aside
        className="v2-scope hidden md:flex flex-col v2-citizen-sidebar"
        style={{
          position: "fixed",
          top: "var(--v2-topbar-height, 56px)",
          left: 0,
          width: "260px",
          height: "calc(100vh - var(--v2-topbar-height, 56px))",
          backgroundColor:
            "var(--color-sidebar-bg, var(--color-header-bg, var(--color-primary-1, #204F37)))",
          borderRight:
            "1px solid var(--color-sidebar-bg, var(--color-border, #d6d5d4))",
          zIndex: 10,
        }}
      >
        <div className="m-4 h-20 w-20 self-center rounded-full bg-muted animate-pulse" />
        <div className="m-2 space-y-2 px-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 rounded-md bg-muted/50 animate-pulse" />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="v2-scope hidden md:flex flex-col v2-citizen-sidebar"
      style={{
        // `position: fixed` matches the employee sidebar behaviour —
        // the sidebar is anchored to the viewport (top right of the
        // topbar to viewport bottom) and lifted out of the
        // .citizen-home-container flex row. With the sidebar out of
        // the row's intrinsic height, the row collapses to its main
        // content height and the page footer ("Powered by DIGIT")
        // sits below the row at the bottom of body content — visible
        // without scrolling on short pages, just like employee.
        position: "fixed",
        top: "var(--v2-topbar-height, 56px)",
        left: 0,
        width: "260px",
        height: "calc(100vh - var(--v2-topbar-height, 56px))",
        backgroundColor:
          "var(--color-sidebar-bg, var(--color-header-bg, var(--color-primary-1, #204F37)))",
        borderRight: "1px solid var(--color-sidebar-bg, var(--color-border, #d6d5d4))",
        zIndex: 10,
      }}
    >
      {isLoggedInCitizen ? <Profile info={user.info} /> : null}
      <nav
        className="flex flex-col flex-1 overflow-y-auto"
        style={{ padding: "8px", gap: "1px" }}
        aria-label={t("CORE_COMMON_NAVIGATION") || "Sidebar navigation"}
      >
        <ConfirmDialog
          open={logoutOpen}
          title={t("CORE_LOGOUT_WEB_HEADER") === "CORE_LOGOUT_WEB_HEADER" ? "Log out?" : t("CORE_LOGOUT_WEB_HEADER")}
          body={
            (t("CORE_LOGOUT_WEB_CONFIRMATION_MESSAGE") === "CORE_LOGOUT_WEB_CONFIRMATION_MESSAGE"
              ? "You'll be signed out of this device. "
              : t("CORE_LOGOUT_WEB_CONFIRMATION_MESSAGE") + " ")
          }
          cancelLabel={t("CORE_LOGOUT_CANCEL") === "CORE_LOGOUT_CANCEL" ? "Cancel" : t("CORE_LOGOUT_CANCEL")}
          confirmLabel={t("CORE_LOGOUT_WEB_YES") === "CORE_LOGOUT_WEB_YES" ? "Yes, log out" : t("CORE_LOGOUT_WEB_YES")}
          onCancel={() => setLogoutOpen(false)}
          onConfirm={() => {
            setLogoutOpen(false);
            Digit?.UserService?.logout?.();
            // Most digit deployments handle the redirect themselves, but
            // belt-and-braces: push to the citizen login if we're still on
            // a citizen page after the call.
            try {
              if (typeof window !== "undefined" && window.location?.pathname?.startsWith(`/${contextPath}/citizen`)) {
                window.location.href = `/${contextPath}/citizen/login`;
              }
            } catch {}
          }}
        />
        {items.map((item, i) => {
          const isActive = (() => {
            const path = location.pathname;
            // Always treat an exact match on the landing URL as active.
            // Module sidebar URLs like /pgr-home don't startsWith their
            // derived prefix /pgr, so without this the row would lose
            // its highlight on the very page it points at.
            if (item.link && (path === item.link || path === item.link + "/")) {
              return true;
            }
            if (item.matchPrefixes?.length) {
              // Sort longer prefixes first so a more specific match wins
              // when prefixes overlap.
              const sorted = [...item.matchPrefixes].sort(
                (a, b) => b.length - a.length
              );
              for (const p of sorted) {
                if (path === p || path.startsWith(p + "/")) return true;
              }
            }
            return false;
          })();
          return (
            <SidebarRow key={i} item={item} isActive={isActive} />
          );
        })}
      </nav>
    </aside>
  );
}
