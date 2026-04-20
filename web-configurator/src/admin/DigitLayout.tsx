import { useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DocsPane from '@/components/layout/DocsPane';
import { getGenericMdmsResources, getResourceLabel } from '@/providers/bridge';

/** Sidebar navigation groups */
const navGroups = [
  {
    label: 'Tenant Management',
    items: [
      { id: 'tenants', name: 'Tenants', path: '/manage/tenants', icon: Building2 },
      { id: 'departments', name: 'Departments', path: '/manage/departments', icon: Briefcase },
      { id: 'designations', name: 'Designations', path: '/manage/designations', icon: Award },
      { id: 'boundary-hierarchies', name: 'Hierarchies', path: '/manage/boundary-hierarchies', icon: GitBranch },
    ],
  },
  {
    label: 'Complaint Management',
    items: [
      { id: 'complaint-types', name: 'Complaint Types', path: '/manage/complaint-types', icon: AlertTriangle },
      { id: 'complaints', name: 'Complaints', path: '/manage/complaints', icon: MessageSquare },
      { id: 'localization', name: 'Localization', path: '/manage/localization', icon: Globe },
    ],
  },
  {
    label: 'People',
    items: [
      { id: 'employees', name: 'Employees', path: '/manage/employees', icon: Users },
      { id: 'users', name: 'Users', path: '/manage/users', icon: User },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'access-roles', name: 'Access Roles', path: '/manage/access-roles', icon: Shield },
      { id: 'workflow-business-services', name: 'Workflows', path: '/manage/workflow-business-services', icon: Workflow },
      { id: 'workflow-processes', name: 'Processes', path: '/manage/workflow-processes', icon: History },
      { id: 'mdms-schemas', name: 'MDMS Schemas', path: '/manage/mdms-schemas', icon: FileCode },
      { id: 'boundaries', name: 'Boundaries', path: '/manage/boundaries', icon: MapPin },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    // Auto-expand groups that contain the active route, collapse others
    const initial: Record<string, boolean> = {};
    for (const group of navGroups) {
      const hasActive = group.items.some(
        (item) => location.pathname === item.path || location.pathname.startsWith(item.path + '/')
      );
      initial[group.label] = !hasActive; // collapsed = true means hidden
    }
    return initial;
  });
  const [advancedExpanded, setAdvancedExpanded] = useState(() =>
    advancedResources.some((r) => location.pathname.startsWith(r.path))
  );

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
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
              title={sidebarCollapsed ? 'Dashboard' : undefined}
            >
              <LayoutDashboard className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-medium">Dashboard</span>}
            </button>
          </div>

          {/* Grouped navigation */}
          {navGroups.map((group) => {
            const isCollapsed = collapsedGroups[group.label];
            return (
              <div key={group.label} className="mt-3">
                {!sidebarCollapsed && (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className="w-full flex items-center px-3 mb-1 group cursor-pointer"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 group-hover:text-muted-foreground flex-1 text-left">
                      {group.label}
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
                          title={sidebarCollapsed ? item.name : undefined}
                        >
                          <Icon className="w-4.5 h-4.5 flex-shrink-0" />
                          {!sidebarCollapsed && (
                            <span className="text-sm font-medium">{item.name}</span>
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
              title={sidebarCollapsed ? 'Advanced' : undefined}
            >
              <Database className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="text-sm font-medium flex-1 text-left">Advanced</span>
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
            title={sidebarCollapsed ? 'Switch to Onboarding' : undefined}
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && (
              <span className="text-sm">Switch to Onboarding</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-card sticky top-0 z-40 shadow-card border-b border-border">
          <div className="h-1 bg-primary" />
          <div className="px-6 h-14 flex items-center justify-between">
            {/* Left: Management Mode badge */}
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="text-xs bg-blue-50 text-blue-700 border-blue-200"
              >
                Management Mode
              </Badge>
            </div>

            {/* Right: env, help, user */}
            <div className="flex items-center gap-4">
              <Badge
                variant="secondary"
                className="text-xs bg-primary/10 text-primary border-primary/20"
              >
                {envName}
              </Badge>

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleHelp}
                className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <HelpCircle className="w-5 h-5" />
              </Button>

              <div className="flex items-center gap-2 pl-4 border-l border-border">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {state.user?.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{state.tenant}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-9 w-9"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
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
