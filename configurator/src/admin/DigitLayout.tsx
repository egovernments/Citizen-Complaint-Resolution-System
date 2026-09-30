import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLocaleState, useLocales, useTranslate } from 'ra-core';
import { useApp } from '../App';
import {
  HelpCircle,
  LogOut,
  User,
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
  Menu,
  X,
  Settings,
  Globe,
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
  MessageCircle,
  UserCog,
  Map,
  Globe2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getGenericMdmsResources, getResourceLabel } from '@/providers/bridge';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { useTheme } from '@/providers/ThemeProvider';
import { THEMES } from '@/themes';
import { LEGACY_PGR_DASHBOARD_ENABLED } from '@/config/featureFlags';
import { DigitFooter } from '@/components/DigitFooter';

/** Sidebar navigation groups — names are i18n keys resolved at render time */
const navGroups = [
  {
    labelKey: 'app.nav.notifications',
    items: [
      { id: 'notification-configure', nameKey: 'app.nav.notification_configure', path: '/manage/notification-configure', icon: SlidersHorizontal },
      { id: 'notification-routing', nameKey: 'app.nav.notification_routing', path: '/manage/notification-routing', icon: Bell },
      { id: 'notification-template', nameKey: 'app.nav.notification_templates', path: '/manage/notification-template', icon: Mail },
      { id: 'notification-provider-template', nameKey: 'app.nav.notification_provider_templates', path: '/manage/notification-provider-template', icon: MessageCircle },
      { id: 'notification-log', nameKey: 'app.nav.notification_logs', path: '/manage/notification-log', icon: ScrollText },
      { id: 'notification-provider', nameKey: 'app.nav.notification_providers', path: '/manage/notification-provider', icon: Plug },
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

/** Row states from the DIGIT admin console: tinted when current, a lighter tint on hover. */
const rowTone = (active: boolean) =>
  active ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-primary/5 hover:text-primary';

/** The 3px primary bar on the current row's left edge. */
function ActiveBar() {
  return <span aria-hidden="true" className="absolute left-0 inset-y-0 w-[3px] bg-primary" />;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="h-8 px-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * A full-bleed sidebar row: 36px for one line of text, growing when a long
 * label wraps (text-left keeps the wrapped line on the label's left edge;
 * buttons centre text by default).
 */
function NavRow({
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
  trailing,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`relative w-full min-h-9 flex items-center gap-3 py-2 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${collapsed ? 'justify-center px-0' : 'px-4'} ${rowTone(active)}`}
    >
      {active && <ActiveBar />}
      <Icon className="w-4 h-4 flex-shrink-0" />
      {!collapsed && <span className="flex-1 min-w-0">{label}</span>}
      {!collapsed && trailing}
    </button>
  );
}

/** Generic MDMS resources for the Advanced section */
const advancedResources = Object.keys(getGenericMdmsResources()).map((name) => ({
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
  // Below md the rail is an off-canvas drawer. It is out only while the page it
  // was opened on is still showing, so picking a link closes it.
  const [mobileNavPath, setMobileNavPath] = useState<string | null>(null);
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

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSwitchToOnboarding = () => {
    setMode('onboarding');
    navigate('/phase/1');
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

  const mobileNavOpen = mobileNavPath === location.pathname;
  const openMobileNav = () => {
    setSidebarCollapsed(false);
    setMobileNavPath(location.pathname);
  };
  const closeMobileNav = () => setMobileNavPath(null);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavPath(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  const userInitial = state.user?.name?.trim().charAt(0).toUpperCase();

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      {mobileNavOpen && (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={closeMobileNav} />
      )}

      {/* Sidebar: the DIGIT admin console's rail. On a phone it slides in over
          the page; invisible while closed so its links leave the tab order. */}
      <aside
        className={`${sidebarCollapsed ? 'w-16' : 'w-64'
          } bg-sidebar border-r border-border flex flex-col transition-all duration-200 h-full fixed inset-y-0 left-0 z-50 md:static md:z-auto md:translate-x-0 md:visible md:shadow-none ${mobileNavOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full invisible'}`}
      >
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
            <button
              type="button"
              onClick={closeMobileNav}
              aria-label={translate('app.nav.close_menu', { _: 'Close menu' })}
              className="md:hidden inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-secondary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="w-4 h-4" />
            </button>
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

        {/* Sidebar Footer */}
        <div className="border-t border-border py-2">
          <NavRow
            icon={Settings}
            label={translate('app.nav.switch_to_onboarding')}
            active={false}
            collapsed={sidebarCollapsed}
            onClick={handleSwitchToOnboarding}
          />

          {/* User info */}
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-3 px-4'} pt-2`}>
            <div
              className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center flex-shrink-0 text-sm font-medium"
              title={sidebarCollapsed ? state.user?.name : undefined}
            >
              {userInitial || <User className="w-4 h-4" />}
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {state.user?.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{state.tenant}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  aria-label={translate('ra.auth.logout', { _: 'Logout' })}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 flex-shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header: white and flat, as the DIGIT console draws it */}
        <header className="sticky top-0 z-30 h-14 flex-shrink-0 bg-card border-b border-border pl-4 pr-4 sm:pr-6 flex items-center justify-between gap-2">
          {/* Left: menu (phone), Management Mode + env badges */}
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={openMobileNav}
              aria-label={translate('app.nav.open_menu', { _: 'Open menu' })}
              aria-expanded={mobileNavOpen}
              className="md:hidden -ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Menu className="w-5 h-5" />
            </button>
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

          {/* Right: help, locale, theme */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleHelp}
              aria-label={translate('app.header.help', { _: 'Help' })}
              className="h-8 gap-1.5 px-2 text-sm font-normal text-foreground hover:bg-muted hover:text-foreground"
            >
              <HelpCircle />
              <span className="hidden sm:inline">{translate('app.header.help', { _: 'Help' })}</span>
            </Button>

            <LocaleSwitcher />

            <ThemeSwitcher />
          </div>
        </header>

        {/* Main content */}
        <main id="main-content" className="flex-1 p-4 sm:p-6 overflow-auto min-h-0">
          {children}
        </main>

        {/* Powered by DIGIT (CCRS#1841) + Open DIGIT Docs */}
        {/* Centred attribution from sm up; on a phone the spacer goes, so the
            logo and the docs link share the row without wrapping. */}
        <footer className="flex-shrink-0 flex items-center justify-between gap-4 border-t border-border bg-card px-4 sm:px-6 py-2">
          <div className="hidden sm:block flex-1" />
          <DigitFooter />
          <div className="sm:flex-1 flex justify-end">
            <a
              href="https://docs.digit.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {translate('app.nav.open_digit_docs', { _: 'Open DIGIT Docs' })}
            </a>
          </div>
        </footer>

      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// LocaleSwitcher — compact dropdown using ra-core hooks
// ---------------------------------------------------------------------------
function LocaleSwitcher() {
  const [locale, setLocale] = useLocaleState();
  const locales = useLocales();

  if (!locales || locales.length <= 1) return null;

  return (
    <Select value={locale} onValueChange={setLocale}>
      <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm text-foreground shadow-none hover:bg-muted">
        <Globe className="w-4 h-4 flex-shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l.locale} value={l.locale} className="text-xs">
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// ThemeSwitcher — compact dropdown with color swatch previews
// ---------------------------------------------------------------------------
function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const currentTheme = THEMES.find((t) => t.name === theme);

  return (
    <Select value={theme} onValueChange={setTheme}>
      <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm text-foreground shadow-none hover:bg-muted">
        <span
          className="inline-block w-3 h-3 rounded-full border border-border flex-shrink-0"
          style={{ backgroundColor: currentTheme?.primaryHex }}
        />
        <span className="max-sm:sr-only">Theme</span>
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((t) => (
          <SelectItem key={t.name} value={t.name} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: t.primaryHex }}
              />
              {t.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
