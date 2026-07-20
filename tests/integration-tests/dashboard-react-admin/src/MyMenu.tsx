/**
 * Custom sidebar menu. Layered into three sections:
 *
 *   1. Top-level pages (Dashboard, All tests, Runs)
 *   2. Quick filters that deep-link into pre-filtered test lists
 *      (failing now, onboarding, citizen, employee, admin/configurator)
 *   3. Live footer showing the latest run's pass/fail summary
 *
 * The filter URLs follow react-admin's convention:
 *   /tests?filter={"key":"value"}
 * which pre-populates the List's filters at mount.
 */
import { Menu, useGetList } from 'react-admin';
import { Box, Chip, Divider, Typography } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ListAltIcon from '@mui/icons-material/ListAlt';
import HistoryIcon from '@mui/icons-material/History';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import PersonIcon from '@mui/icons-material/Person';
import BadgeIcon from '@mui/icons-material/Badge';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import HubIcon from '@mui/icons-material/Hub';
import type { RunSummary } from './types';

function filterPath(filter: Record<string, unknown>): string {
  return `/tests?filter=${encodeURIComponent(JSON.stringify(filter))}`;
}

function relTime(iso: string): string {
  if (!iso) return '';
  const dt = (Date.now() - new Date(iso).getTime()) / 1000;
  if (dt < 60) return `${Math.round(dt)}s ago`;
  if (dt < 3600) return `${Math.round(dt/60)}m ago`;
  if (dt < 86400) return `${Math.round(dt/3600)}h ago`;
  return `${Math.round(dt/86400)}d ago`;
}

/**
 * Compact pinned summary card at the bottom of the sidebar — at-a-glance
 * latest-run status without leaving the current page.
 */
function LatestRunFooter() {
  const { data: runs = [] } = useGetList<RunSummary>('runs', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'startedAt', order: 'DESC' },
  });
  const latest = runs[0];
  if (!latest) return null;
  const passPct = latest.total > 0 ? Math.round((latest.passed / latest.total) * 100) : 0;
  const color = passPct > 80 ? 'success' : passPct > 50 ? 'warning' : 'error';
  return (
    <Box sx={{ p: 1.25, mt: 1, mx: 0.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.06)' }}>
      <Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7, fontSize: 10 }}>
        Latest run
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1 }}>
          {passPct}%
        </Typography>
        <Chip
          size="small"
          label={`${latest.passed}/${latest.total}`}
          color={color}
          sx={{ height: 18, fontSize: 10 }}
        />
      </Box>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.7, fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {latest.id.split('_').slice(0, 2).join(' ')}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, fontSize: 10 }}>
        {relTime(latest.startedAt)}
      </Typography>
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        px: 2, mt: 1.5, mb: 0.25,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontSize: 10,
        opacity: 0.65,
      }}
    >
      {children}
    </Typography>
  );
}

export default function MyMenu() {
  return (
    <Menu>
      <Menu.DashboardItem />
      <Menu.Item to="/tests" primaryText="All tests" leftIcon={<ListAltIcon />} />
      <Menu.Item to="/runs" primaryText="Runs" leftIcon={<HistoryIcon />} />

      <SectionLabel>Quick filters</SectionLabel>
      <Menu.Item
        to={filterPath({ lastStatus: 'failed' })}
        primaryText="Failing now"
        leftIcon={<ErrorOutlineIcon />}
      />
      <Menu.Item
        to={filterPath({ tags_any_area: ['@area:onboarding'] })}
        primaryText="Onboarding"
        leftIcon={<RocketLaunchIcon />}
      />
      <Menu.Item
        to={filterPath({ tags_any_area: ['@area:configurator-manage'] })}
        primaryText="Configurator"
        leftIcon={<HubIcon />}
      />

      <SectionLabel>Personas</SectionLabel>
      <Menu.Item
        to={filterPath({ tags_any_persona: ['@persona:citizen'] })}
        primaryText="Citizen flows"
        leftIcon={<PersonIcon />}
      />
      <Menu.Item
        to={filterPath({ tags_any_persona: ['@persona:employee'] })}
        primaryText="Employee flows"
        leftIcon={<BadgeIcon />}
      />
      <Menu.Item
        to={filterPath({ tags_any_persona: ['@persona:admin'] })}
        primaryText="Admin / configurator"
        leftIcon={<AdminPanelSettingsIcon />}
      />

      <Divider sx={{ my: 1, opacity: 0.3 }} />
      <LatestRunFooter />
    </Menu>
  );
}

// hide unused-import warning when DashboardIcon isn't used (DashboardItem
// supplies its own icon).
void DashboardIcon;
