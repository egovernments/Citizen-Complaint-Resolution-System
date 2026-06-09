/**
 * CitizenLayout — top bar + single-item sidebar + content slot.
 *
 * Replaces the operator-side Layout/DigitLayout from the configurator fork.
 * No RHS docs pane, no module switcher, no role-based nav — citizens see one
 * thing (the dashboard) until we add more citizen surfaces. Each future
 * surface is one extra <NavLink> in the sidebar below.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, FileText, UserCircle, BarChart3 } from 'lucide-react';
import { useApp } from '@/App';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { to: '/dashboard', label: 'Citizen Dashboard', icon: LayoutDashboard },
  { to: '/dashboard-v2', label: 'Dashboard v2', icon: BarChart3 },
  { to: '/complaints', label: 'My Complaints', icon: FileText },
  { to: '/profile', label: 'Profile', icon: UserCircle },
];

export default function CitizenLayout() {
  const { state, logout } = useApp();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      {/* Top app bar */}
      <header className="bg-primary text-primary-foreground border-b">
        <div className="px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-semibold tracking-tight">Nai Pepea</div>
            <span className="text-primary-foreground/60 text-sm">·</span>
            <span className="text-sm text-primary-foreground/80">Citizen Portal</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-primary-foreground/80">
              {state.user?.name || (state.user?.mobile ? `+254 ${state.user.mobile}` : '')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-primary-foreground hover:bg-primary-foreground/10"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut className="h-4 w-4 mr-1" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Sidebar + content */}
      <div className="flex-1 flex">
        <aside className="w-60 border-r bg-background">
          <nav className="p-3 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
