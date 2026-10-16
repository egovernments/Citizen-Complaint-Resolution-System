import {
  User,
  Globe,
  Building2,
  MapPin,
  Briefcase,
  Award,
  AlertTriangle,
  Users,
  BarChart3,
  Network,
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
  CalendarClock,
  Palette,
} from 'lucide-react';
import { getGenericMdmsResources, getResourceConfig } from '@/providers/bridge';

/** Sidebar navigation groups — names are i18n keys resolved at render time */
export const navGroups = [
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
    // HERE ONLY — `getAdvancedResourceIds` drops every id already listed in a
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
      // Shown to whoever can see the tenant: branding is the tenant's logo, banner and theme.
      { id: 'branding', gate: 'tenants', nameKey: 'app.nav.branding', path: '/manage/branding', icon: Palette },
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
      { id: 'pgr-escalation', nameKey: 'app.nav.escalation_policy', path: '/manage/escalation-policy', icon: SlidersHorizontal },
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

/** Every resource id that already has its own entry in a primary nav group. */
const primaryNavIds = new Set(navGroups.flatMap((group) => group.items.map((item) => item.id)));

/**
 * Generic MDMS resources for Advanced: the sidebar sub-list and the
 * /manage/advanced grid both read this, so they cannot drift apart.
 *
 * Derived from the menu definition above rather than from a hand-kept list, so
 * a resource promoted into a primary group cannot end up listed twice — which
 * is what "Notification Events / Routing / Templates" were, once under
 * NOTIFICATIONS and again down here under their long registry labels. Anything
 * NOT in a primary group stays, including the read-only Legacy (PGR)
 * Notification masters, for which Advanced is the only way in. `unlisted`
 * resources keep their routes but are listed nowhere.
 */
export function getAdvancedResourceIds(): string[] {
  return Object.keys(getGenericMdmsResources()).filter(
    (name) => !primaryNavIds.has(name) && !getResourceConfig(name)?.unlisted,
  );
}
