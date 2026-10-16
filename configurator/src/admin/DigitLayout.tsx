import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslate } from 'ra-core';
import { useApp } from '../App';
import {
  Building2,
  LayoutDashboard,
  BarChart3,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Database,
  Globe2,
  Inbox,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { T } from '@digit-ui/datagrid';
import { getGenericMdmsResources, getResourceLabel } from '@/providers/bridge';
import { useResourceLabel } from '@/providers/useResourceLabel';
import { ResourceLabel } from '@/providers/ResourceLabel';
import { navGroups, getAdvancedResourceIds } from './navGroups';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { LEGACY_PGR_DASHBOARD_ENABLED } from '@/config/featureFlags';
import { NavRow, NavExternalRow, SectionLabel, ActiveBar, RailBackdrop, RailCloseButton, RailMenuButton, RailPoweredBy } from '@/components/layout/rail';
import { railClasses, rowTone } from '@/components/layout/railStyles';
import { useRailDrawer } from '@/components/layout/useRailDrawer';
import { AccountMenu, HelpButton, LocaleSwitcher, ThemeSwitcher } from '@/components/layout/HeaderControls';
import { isOnboardingComplete } from '@/onboarding/progress';
import { complaintDeskUrl, useWorkspaceSlug } from '@/identity/workspaceSlug';

/** The links above the groups, always shown first */
const mainLinks = [
  { path: '/manage', nameKey: 'app.nav.dashboard', icon: LayoutDashboard },
  ...(LEGACY_PGR_DASHBOARD_ENABLED
    ? [{ path: '/manage/pgr-dashboard', nameKey: 'app.nav.pgr_dashboard', icon: BarChart3 }]
    : []),
  { path: '/manage/public-dashboard', nameKey: 'app.nav.public_dashboard', icon: Globe2 },
];

/** Generic MDMS resources for the Advanced section (see getAdvancedResourceIds). */
const advancedResources = getAdvancedResourceIds().map((name) => ({
  id: name,
  name: getResourceLabel(name),
  path: `/manage/${name}`,
}));

export function DigitLayout({ children }: { children?: ReactNode }) {
  const { state, logout, toggleHelp } = useApp();

  const userRoles = state.user?.roles ?? [];
  const navigate = useNavigate();
  const location = useLocation();
  const translate = useTranslate();
  const resourceLabel = useResourceLabel();
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
              canViewResource((item as { gate?: string }).gate ?? item.id) &&
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

  // Once setup is done, the way to where the workspace's staff handle complaints.
  const slug = useWorkspaceSlug(state.tenant);
  const deskUrl = isOnboardingComplete(state.completedPhases) ? complaintDeskUrl(state.environment, slug) : null;


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
  // Same code and fallback as the list title and dashboard card (resourceLabelKey).
  const advancedLabel = (item: { id: string }) => resourceLabel(item.id);
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
                    <T i18nKey="app.header.product_name">Complaint Management System</T>
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
              {!sidebarCollapsed && <SectionLabel><T i18nKey="app.nav.main">Main</T></SectionLabel>}
              {shownMainLinks.map((link) => (
                <NavRow
                  key={link.path}
                  icon={link.icon}
                  label={translate(link.nameKey)}
                  i18nKey={link.nameKey}
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
                      <span className="flex-1"><T i18nKey={group.labelKey} /></span>
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
                      i18nKey={item.nameKey}
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
                i18nKey="app.nav.advanced"
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
                      <span className="truncate"><ResourceLabel resource={item.id} /></span>
                    </button>
                  );
                })}
            </div>
          )}

          {!sidebarCollapsed && query && nothingFound && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              <T i18nKey="app.nav.no_matches">No matches</T>
            </p>
          )}
        </nav>

        {/* Sidebar footer: the complaint desk once setup is done, then "Powered by DIGIT" */}
        {deskUrl && (
          <div className="border-t border-border py-2">
            <NavExternalRow
              icon={Inbox}
              label={translate('app.nav.open_complaint_desk', { _: 'Open complaint desk' })}
              i18nKey="app.nav.open_complaint_desk"
              href={deskUrl}
              collapsed={sidebarCollapsed}
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
              <T i18nKey="app.header.management_mode" />
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
