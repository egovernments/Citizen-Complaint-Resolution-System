import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslate } from 'ra-core';
import { useApp } from '../App';
import {
  User,
  Globe,
  Building2,
  MapPin,
  Briefcase,
  Award,
  AlertTriangle,
  Users,
  LayoutDashboard,
  BarChart3,
  Network,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Database,
  Shield,
  GitBranch,
  MessageSquare,
  History,
  FileCode,
  Workflow,
  Bell,
  Mail,
  ScrollText,
  Plug,
  SlidersHorizontal,
  ToggleRight,
  MessageCircle,
  UserCog,
  Map,
  Globe2,
  CalendarClock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getGenericMdmsResources, getResourceLabel } from '@/providers/bridge';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { LEGACY_PGR_DASHBOARD_ENABLED, ONBOARDING_GATE_ENABLED } from '@/config/featureFlags';
import { NavRow, SectionLabel, ActiveBar, RailBackdrop, RailCloseButton, RailMenuButton, RailPoweredBy } from '@/components/layout/rail';
import { railClasses, rowTone } from '@/components/layout/railStyles';
import { useRailDrawer } from '@/components/layout/useRailDrawer';
import { AccountMenu, HelpButton, LocaleSwitcher, ThemeSwitcher } from '@/components/layout/HeaderControls';
import { resumePath } from '@/onboarding/progress';

/** Sidebar navigation groups — names are i18n keys resolved at render time */
const navGroups = [
  {
    labelKey: 'app.nav.notifications',
    // Ordered the way a first-time operator needs them, not alphabetically and
    // not by storage: a gateway account must exist (Providers) before a channel
    // can be switched on (Channels), before anything can be configured
    // (Configure), which is read against the vocabulary (Events). The raw
    // Templates/Routing masters come after the guided screen because they are
    // the bulk-edit path, WhatsApp's extra step after them, and Logs last —
    // that is where you go once something has been sent. User Preferences is
    // per-citizen data, not setup, so it sits at the end.
    //
    // Labels drop the "Notification" prefix: inside a menu already titled
    // Notifications it read as "Notifications → Notification Routing". The page
    // TITLES keep the long form so a screen is unambiguous out of context.
    //
    // The masters below are the shared NOTIFICATIONS.* ones, and they appear
    // HERE ONLY — `advancedResources` drops every id already listed in a
    // primary group, so Advanced no longer repeats "Notification Events /
    // Routing / Templates" a second time under different labels.
    //
    // The legacy RAINMAKER-PGR.Notification* four are deliberately NOT in this
    // group: they are read-only history, still reachable at
    // /manage/notification-<x> and, because they are in no primary group, still
    // listed in Advanced — so an operator on an un-migrated tenant can see their
    // data without the sidebar offering two of everything.
    items: [
      { id: 'notification-provider', nameKey: 'app.nav.notification_providers', path: '/manage/notification-provider', icon: Plug },
      { id: 'notifications-channel', nameKey: 'app.nav.notification_channels', path: '/manage/notifications-channel', icon: ToggleRight },
      { id: 'notification-configure', nameKey: 'app.nav.notification_configure', path: '/manage/notification-configure', icon: SlidersHorizontal },
      { id: 'notifications-event-catalogue', nameKey: 'app.nav.notification_events', path: '/manage/notifications-event-catalogue', icon: CalendarClock },
      { id: 'notifications-template', nameKey: 'app.nav.notification_templates', path: '/manage/notifications-template', icon: Mail },
      { id: 'notifications-routing', nameKey: 'app.nav.notification_routing', path: '/manage/notifications-routing', icon: Bell },
      { id: 'notifications-provider-template', nameKey: 'app.nav.notification_provider_templates', path: '/manage/notifications-provider-template', icon: MessageCircle },
      { id: 'notification-log', nameKey: 'app.nav.notification_logs', path: '/manage/notification-log', icon: ScrollText },
      { id: 'notification-preference', nameKey: 'app.nav.notification_preferences', path: '/manage/notification-preference', icon: UserCog },
    ],
  },
  {
    labelKey: 'app.nav.tenant_management',
    items: [
      { id: 'tenants', nameKey: 'app.nav.tenants', path: '/manage/tenants', icon: Building2 },
      { id: 'departments', nameKey: 'app.nav.departments', path: '/manage/departments', icon: Briefcase },
      { id: 'designations', nameKey: 'app.nav.designations', path: '/manage/designations', icon: Award },
      { id: 'boundary-hierarchies', nameKey: 'app.nav.hierarchies', path: '/manage/boundary-hierarchies', icon: GitBranch },
      { id: 'map-config', nameKey: 'app.nav.map_config', path: '/manage/map-config', icon: Map },
    ],
  },
  {
    labelKey: 'app.nav.complaint_management',
    items: [
      { id: 'complaint-hierarchies', nameKey: 'app.nav.complaint_hierarchies', path: '/manage/complaint-hierarchies', icon: GitBranch },
      { id: 'complaint-hierarchy', nameKey: 'app.nav.complaint_types', path: '/manage/complaint-hierarchy', icon: AlertTriangle },
      { id: 'complaints', nameKey: 'app.nav.complaints', path: '/manage/complaints', icon: MessageSquare },
      { id: 'localization', nameKey: 'app.nav.localization', path: '/manage/localization', icon: Globe },
    ],
  },
  {
    labelKey: 'app.nav.people',
    items: [
      { id: 'employees', nameKey: 'app.nav.employees', path: '/manage/employees', icon: Users },
      { id: 'org-chart', nameKey: 'app.nav.org_chart', path: '/manage/org-chart', icon: Network },
      { id: 'users', nameKey: 'app.nav.users', path: '/manage/users', icon: User },
    ],
  },
  {
    labelKey: 'app.nav.system',
    items: [
      { id: 'access-roles', nameKey: 'app.nav.access_roles', path: '/manage/access-roles', icon: Shield },
      { id: 'workflow-business-services', nameKey: 'app.nav.workflows', path: '/manage/workflow-business-services', icon: Workflow },
      { id: 'workflow-processes', nameKey: 'app.nav.processes', path: '/manage/workflow-processes', icon: History },
      { id: 'mdms-schemas', nameKey: 'app.nav.mdms_schemas', path: '/manage/mdms-schemas', icon: FileCode },
      { id: 'boundaries', nameKey: 'app.nav.boundaries', path: '/manage/boundaries', icon: MapPin },
      // Only useful to people who can change destinations; requiredRoles keeps it
      // out of everyone else's sidebar (the route itself renders read-only for
      // them, so this is a tidiness gate, not the security boundary).
      { id: 'analytics-providers', nameKey: 'app.nav.analytics_providers', path: '/manage/analytics-providers', icon: BarChart3, requiredRoles: ['SUPERUSER', 'MDMS_ADMIN'] },
    ],
  },
];

/** The links above the groups, always shown first */
const mainLinks = [
  { path: '/manage', nameKey: 'app.nav.dashboard', icon: LayoutDashboard },
  ...(LEGACY_PGR_DASHBOARD_ENABLED
    ? [{ path: '/manage/pgr-dashboard', nameKey: 'app.nav.pgr_dashboard', icon: BarChart3 }]
    : []),
  { path: '/manage/public-dashboard', nameKey: 'app.nav.public_dashboard', icon: Globe2 },
];

/** Every resource id that already has its own entry in a primary nav group. */
const primaryNavIds = new Set(navGroups.flatMap((group) => group.items.map((item) => item.id)));

/**
 * Generic MDMS resources for the Advanced section.
 *
 * Derived from the menu definition above rather than from a hand-kept list, so
 * a resource promoted into a primary group cannot end up listed twice — which
 * is what "Notification Events / Routing / Templates" were, once under
 * NOTIFICATIONS and again down here under their long registry labels. Anything
 * NOT in a primary group stays, including the read-only Legacy (PGR)
 * Notification masters, for which Advanced is the only way in.
 */
const advancedResources = Object.keys(getGenericMdmsResources())
  .filter((name) => !primaryNavIds.has(name))
  .map((name) => ({
    id: name,
    name: getResourceLabel(name),
    path: `/manage/${name}`,
  }));

export function DigitLayout({ children }: { children?: ReactNode }) {
  const { state, logout, setMode, toggleHelp } = useApp();

  const userRoles = state.user?.roles ?? [];
  const navigate = useNavigate();
  const location = useLocation();
  const translate = useTranslate();
  const { canViewResource } = useMastersCapability();

  // Masters the current role can't see (per resource.masters conditions on
  // the shared MDMS search action) drop out of nav entirely — UI-level only,
  // see docs/reference/architecture/access-control/masters-configurator-access-policy-design.md §3.3.
  // Two independent gates, and a nav item must clear BOTH. `canViewResource` is
  // master's masters-capability gate; `requiredRoles` is #1584's tidiness gate for
  // items that are only useful to a couple of roles. The rebase brought both in
  // under the same name, which is why they are composed here rather than picked.
  const roleKey = userRoles.join(',');
  const visibleNavGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              canViewResource(item.id) &&
              (!('requiredRoles' in item) ||
                !!(item as { requiredRoles?: string[] }).requiredRoles?.some((r) => roleKey.split(',').includes(r))),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [canViewResource, roleKey],
  );
  const visibleAdvancedResources = useMemo(
    () => advancedResources.filter((r) => canViewResource(r.id)),
    [canViewResource],
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const drawer = useRailDrawer();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    // Auto-expand groups that contain the active route, collapse others
    const initial: Record<string, boolean> = {};
    for (const group of navGroups) {
      const hasActive = group.items.some(
        (item) => location.pathname === item.path || location.pathname.startsWith(item.path + '/')
      );
      initial[group.labelKey] = !hasActive; // collapsed = true means hidden
    }
    return initial;
  });
  const [advancedExpanded, setAdvancedExpanded] = useState(() =>
    advancedResources.some((r) => location.pathname.startsWith(r.path))
  );

  const toggleGroup = (labelKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [labelKey]: !prev[labelKey] }));
  };

  const handleLogout = async () => {
    try { await logout(); navigate('/login'); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'Sign-out failed. Please retry.'); }
  };

  const handleSwitchToOnboarding = () => {
    setMode('onboarding');
    navigate(resumePath(state.completedPhases));
  };

  const envName = state.environment.includes('api.egov.theflywheel') || state.environment.includes('chakshu')
    ? 'chakshu-dev'
    : state.environment.includes('unified-dev')
      ? 'unified-dev'
      : state.environment.includes('staging')
        ? 'staging'
        : state.environment.includes('uat')
          ? 'uat'
          : 'custom';

  const query = navQuery.trim().toLowerCase();
  const matches = (label: string) => !query || label.toLowerCase().includes(query);
  const advancedLabel = (item: { id: string; name: string }) =>
    translate(`app.resources.${item.id.replace(/-/g, '_')}`, { _: item.name });
  const shownMainLinks = mainLinks.filter((link) => matches(translate(link.nameKey)));
  const shownGroups = visibleNavGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => matches(translate(item.nameKey))) }))
    .filter((group) => group.items.length > 0);
  // A search naming "Advanced" itself lists every resource under it; otherwise
  // only the resources whose names match, with the section opened to show them.
  const advancedNameMatches = matches(translate('app.nav.advanced'));
  const shownAdvanced = advancedNameMatches
    ? visibleAdvancedResources
    : visibleAdvancedResources.filter((item) => matches(advancedLabel(item)));
  const showAdvancedSection = advancedNameMatches || shownAdvanced.length > 0;
  const advancedOpen = advancedExpanded || (!!query && !advancedNameMatches);
  const nothingFound = shownMainLinks.length === 0 && shownGroups.length === 0 && !showAdvancedSection;

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => !collapsed);
    setNavQuery('');
  };

  const openMobileNav = () => {
    setSidebarCollapsed(false);
    drawer.openDrawer();
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      <RailBackdrop open={drawer.open} onClose={drawer.closeDrawer} />

      {/* Sidebar: the DIGIT admin console's rail; a drawer on a phone */}
      <aside className={railClasses(sidebarCollapsed, drawer.open)}>
        {/* Brand, collapse toggle and nav search */}
        <div className="border-b border-border p-3 space-y-5">
          <div className={`flex items-center min-h-9 ${sidebarCollapsed ? 'justify-center' : 'gap-2.5'}`}>
            {!sidebarCollapsed && (
              <>
                <div className="w-7 h-7 rounded bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-5 text-foreground truncate">DIGIT</p>
                  <p className="text-xs leading-4 text-muted-foreground truncate">
                    {translate('app.header.brand', { _: 'Complaints Management' })}
                  </p>
                </div>
              </>
            )}
            <RailCloseButton
              label={translate('app.nav.close_menu', { _: 'Close menu' })}
              onClick={drawer.closeDrawer}
            />
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed
                ? translate('app.nav.expand_sidebar', { _: 'Expand sidebar' })
                : translate('app.nav.collapse_sidebar', { _: 'Collapse sidebar' })}
              className="hidden md:inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-secondary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
          {!sidebarCollapsed && (
            <div className="relative">
              <input
                type="text"
                value={navQuery}
                onChange={(event) => setNavQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setNavQuery('');
                }}
                placeholder={translate('app.nav.search', { _: 'Search' })}
                aria-label={translate('app.nav.search', { _: 'Search' })}
                className="w-full h-8 pl-3 pr-8 text-xs rounded border border-border bg-sidebar text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-secondary"
              />
              <Search aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {shownMainLinks.length > 0 && (
            <div className="pb-5">
              {!sidebarCollapsed && <SectionLabel>{translate('app.nav.main', { _: 'Main' })}</SectionLabel>}
              {shownMainLinks.map((link) => (
                <NavRow
                  key={link.path}
                  icon={link.icon}
                  label={translate(link.nameKey)}
                  active={location.pathname === link.path}
                  collapsed={sidebarCollapsed}
                  onClick={() => navigate(link.path)}
                />
              ))}
            </div>
          )}

          {/* Grouped navigation. With the rail collapsed there are no labels to
              open a group by, so every item shows as an icon. */}
          {shownGroups.map((group) => {
            const isOpen = sidebarCollapsed || !!query || !collapsedGroups[group.labelKey];
            return (
              <div key={group.labelKey} className={isOpen ? 'pb-5' : undefined}>
                {!sidebarCollapsed && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.labelKey)}
                    aria-expanded={isOpen}
                    className="w-full text-left focus-visible:outline-none focus-visible:bg-muted"
                  >
                    <SectionLabel>
                      <span className="flex-1">{translate(group.labelKey)}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`w-3 h-3 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                      />
                    </SectionLabel>
                  </button>
                )}
                {isOpen &&
                  group.items.map((item) => (
                    <NavRow
                      key={item.id}
                      icon={item.icon}
                      label={translate(item.nameKey)}
                      active={location.pathname === item.path || location.pathname.startsWith(item.path + '/')}
                      collapsed={sidebarCollapsed}
                      onClick={() => navigate(item.path)}
                    />
                  ))}
              </div>
            );
          })}

          {/* Advanced: the generic MDMS resources */}
          {showAdvancedSection && (
            <div className="pb-2">
              <NavRow
                icon={Database}
                label={translate('app.nav.advanced')}
                active={location.pathname === '/manage/advanced'}
                collapsed={sidebarCollapsed}
                onClick={() => {
                  if (sidebarCollapsed) {
                    navigate('/manage/advanced');
                  } else {
                    setAdvancedExpanded(!advancedOpen);
                  }
                }}
                trailing={
                  <ChevronDown
                    aria-hidden="true"
                    className={`w-4 h-4 text-muted-foreground transition-transform ${advancedOpen ? '' : '-rotate-90'}`}
                  />
                }
              />
              {!sidebarCollapsed && advancedOpen &&
                shownAdvanced.map((item) => {
                  const isActive = location.pathname.startsWith(item.path);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.path)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`relative w-full min-h-8 flex items-center pl-11 pr-4 py-1.5 text-xs text-left transition-colors ${rowTone(isActive)}`}
                    >
                      {isActive && <ActiveBar />}
                      <span className="truncate">{advancedLabel(item)}</span>
                    </button>
                  );
                })}
            </div>
          )}

          {!sidebarCollapsed && query && nothingFound && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {translate('app.nav.no_matches', { _: 'No matches' })}
            </p>
          )}
        </nav>

        {/* Sidebar footer: the way back to onboarding while switching is
            allowed (with onboarding compulsory there is nothing to go back to),
            then "Powered by DIGIT" */}
        {!ONBOARDING_GATE_ENABLED && (
          <div className="border-t border-border py-2">
            <NavRow
              icon={Settings}
              label={translate('app.nav.switch_to_onboarding')}
              active={false}
              collapsed={sidebarCollapsed}
              onClick={handleSwitchToOnboarding}
            />
          </div>
        )}
        <RailPoweredBy collapsed={sidebarCollapsed} />
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header: white and flat, as the DIGIT console draws it */}
        <header className="sticky top-0 z-30 h-14 flex-shrink-0 bg-card border-b border-border pl-4 pr-4 sm:pr-6 flex items-center justify-between gap-2">
          {/* Left: menu (phone), Management Mode + env badges */}
          <div className="flex items-center gap-2 min-w-0">
            <RailMenuButton
              open={drawer.open}
              label={translate('app.nav.open_menu', { _: 'Open menu' })}
              onClick={openMobileNav}
            />
            <Badge
              variant="outline"
              className="hidden sm:inline-flex text-xs bg-blue-50 text-blue-700 border-blue-200"
            >
              {translate('app.header.management_mode')}
            </Badge>
            <Badge
              variant="secondary"
              className="text-xs bg-primary/10 text-primary border-primary/20"
            >
              {envName}
            </Badge>
          </div>

          {/* Right: help, locale, theme, and the account */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <HelpButton label={translate('app.header.help', { _: 'Help' })} onClick={toggleHelp} />

            <LocaleSwitcher />

            <ThemeSwitcher />

            <AccountMenu
              name={state.user?.name}
              tenant={state.tenant}
              accountLabel={translate('app.header.account', { _: 'Account' })}
              docsLabel={translate('app.nav.open_digit_docs', { _: 'Open DIGIT Docs' })}
              signOutLabel={translate('app.header.sign_out', { _: 'Sign out' })}
              onSignOut={handleLogout}
            />
          </div>
        </header>

        {/* Main content */}
        <main id="main-content" className="flex-1 p-4 sm:p-6 overflow-auto min-h-0">
          {children}
        </main>

        {/* Powered by DIGIT (CCRS#1841) + Open DIGIT Docs */}

      </div>

    </div>
  );
}
