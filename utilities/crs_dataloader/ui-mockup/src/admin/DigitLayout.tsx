import { useState, type ReactNode } from 'react';
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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  Globe,
  Database,
  Shield,
  GitBranch,
  MessageSquare,
  History,
  FileCode,
  Workflow,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DocsPane from '@/components/layout/DocsPane';
import { getGenericMdmsResources, getResourceLabel } from '@/providers/bridge';
import { useTheme } from '@/providers/ThemeProvider';
import { THEMES } from '@/themes';

/** Sidebar navigation groups — names are i18n keys resolved at render time */
const navGroups = [
  {
    labelKey: 'app.nav.tenant_management',
    items: [
      { id: 'tenants', nameKey: 'app.nav.tenants', path: '/manage/tenants', icon: Building2 },
      { id: 'departments', nameKey: 'app.nav.departments', path: '/manage/departments', icon: Briefcase },
      { id: 'designations', nameKey: 'app.nav.designations', path: '/manage/designations', icon: Award },
      { id: 'boundary-hierarchies', nameKey: 'app.nav.hierarchies', path: '/manage/boundary-hierarchies', icon: GitBranch },
    ],
  },
  {
    labelKey: 'app.nav.complaint_management',
    items: [
      { id: 'complaint-types', nameKey: 'app.nav.complaint_types', path: '/manage/complaint-types', icon: AlertTriangle },
      { id: 'complaints', nameKey: 'app.nav.complaints', path: '/manage/complaints', icon: MessageSquare },
      { id: 'localization', nameKey: 'app.nav.localization', path: '/manage/localization', icon: Globe },
    ],
  },
  {
    labelKey: 'app.nav.people',
    items: [
      { id: 'employees', nameKey: 'app.nav.employees', path: '/manage/employees', icon: Users },
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
    ],
  },
];

/** Generic MDMS resources for the Advanced section */
const advancedResources = Object.keys(getGenericMdmsResources()).map((name) => ({
  id: name,
  name: getResourceLabel(name),
  path: `/manage/${name}`,
}));

export function DigitLayout({ children }: { children?: ReactNode }) {
  const { state, logout, setMode, toggleHelp } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const translate = useTranslate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-16' : 'w-64'
        } bg-card border-r border-border flex flex-col transition-all duration-200`}
      >
        {/* Sidebar Header — DIGIT Studio branding */}
        <div className="h-16 border-b border-border flex items-center px-4 gap-2">
          <div className="w-1 h-8 bg-primary" />
          {!sidebarCollapsed && (
            <div>
              <span className="font-condensed font-bold text-foreground">DIGIT</span>
              <span className="font-condensed font-medium text-muted-foreground ml-1">
                Studio
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="ml-auto h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 overflow-y-auto">
          {/* Dashboard always first */}
          <div className="mb-2">
            <button
              onClick={() => navigate('/manage')}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors
                ${location.pathname === '/manage'
                  ? 'bg-primary/10 text-primary border-l-2 border-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
              `}
              title={sidebarCollapsed ? translate('app.nav.dashboard') : undefined}
            >
              <LayoutDashboard className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-medium">{translate('app.nav.dashboard')}</span>}
            </button>
          </div>

          {/* Grouped navigation */}
          {navGroups.map((group) => {
            const isCollapsed = collapsedGroups[group.labelKey];
            return (
              <div key={group.labelKey} className="mt-3">
                {!sidebarCollapsed && (
                  <button
                    onClick={() => toggleGroup(group.labelKey)}
                    className="w-full flex items-center px-3 mb-1 group cursor-pointer"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 group-hover:text-muted-foreground flex-1 text-left">
                      {translate(group.labelKey)}
                    </span>
                    <ChevronDown
                      className={`w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    />
                  </button>
                )}
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        location.pathname === item.path ||
                        location.pathname.startsWith(item.path + '/');
                      return (
                        <button
                          key={item.id}
                          onClick={() => navigate(item.path)}
                          className={`
                            w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors
                            ${isActive
                              ? 'bg-primary/10 text-primary border-l-2 border-primary'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                          `}
                          title={sidebarCollapsed ? translate(item.nameKey) : undefined}
                        >
                          <Icon className="w-4.5 h-4.5 flex-shrink-0" />
                          {!sidebarCollapsed && (
                            <span className="text-sm font-medium">{translate(item.nameKey)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Advanced Section — expandable list of generic MDMS resources */}
          <div className="mt-4 pt-4 border-t border-border">
            <button
              onClick={() => {
                if (sidebarCollapsed) {
                  navigate('/manage/advanced');
                } else {
                  setAdvancedExpanded(!advancedExpanded);
                }
              }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors
                ${
                  location.pathname === '/manage/advanced'
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }
              `}
              title={sidebarCollapsed ? translate('app.nav.advanced') : undefined}
            >
              <Database className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="text-sm font-medium flex-1 text-left">{translate('app.nav.advanced')}</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${advancedExpanded ? '' : '-rotate-90'}`}
                  />
                </>
              )}
            </button>

            {!sidebarCollapsed && advancedExpanded && (
              <div className="mt-1 space-y-0.5 ml-2">
                {advancedResources.map((item) => {
                  const isActive = location.pathname.startsWith(item.path);
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.path)}
                      className={`
                        w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-left
                        ${
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }
                      `}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 flex-shrink-0" />
                      <span className="text-xs font-medium truncate">{item.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-border p-3 space-y-2">
          <button
            onClick={handleSwitchToOnboarding}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={sidebarCollapsed ? translate('app.nav.switch_to_onboarding') : undefined}
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && (
              <span className="text-sm">{translate('app.nav.switch_to_onboarding')}</span>
            )}
          </button>

          {/* User info */}
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2 px-3'} py-2`}>
            <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-primary" />
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
        {/* Header */}
        <header className="bg-card sticky top-0 z-40 shadow-card border-b border-border">
          <div className="h-1 bg-primary" />
          <div className="px-6 h-14 flex items-center justify-between">
            {/* Left: Management Mode + env badges */}
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="text-xs bg-blue-50 text-blue-700 border-blue-200"
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

            {/* Right: locale, theme, help */}
            <div className="flex items-center gap-3">
              {/* Locale switcher */}
              <LocaleSwitcher />

              {/* Theme switcher */}
              <ThemeSwitcher />

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleHelp}
                className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <HelpCircle className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main id="main-content" className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>

      {/* Documentation Pane */}
      <DocsPane />
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
      <SelectTrigger className="h-8 w-[80px] text-xs border-border bg-transparent">
        <Globe className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
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
      <SelectTrigger className="h-8 w-[90px] text-xs border-border bg-transparent">
        <span
          className="inline-block w-3 h-3 rounded-full border border-border flex-shrink-0 mr-1"
          style={{ backgroundColor: currentTheme?.primaryHex }}
        />
        Theme
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
