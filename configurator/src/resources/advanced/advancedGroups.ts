/**
 * ours (cfgreview F21, #1567): the Advanced masters by area, each with one line on what it changes. Platform holds
 * installation-wide settings and legacy masters: it is offered at the state only, never to a county admin.
 */
export interface AdvancedGroup { id: string; title: string; blurb: string; items: { name: string; description: string }[] }

const GROUPS: { id: string; title: string; blurb: string; items: Record<string, string> }[] = [
  { id: 'complaints', title: 'Complaints', blurb: 'How complaints are categorised, shown and escalated.', items: {
    'complaint-hierarchy-nodes': 'Every level of the complaint category tree, including the groups above the categories.',
    'inbox-visibility': 'Which complaints each role sees in the employee inbox.',
    'pgr-ui-constants': 'Complaint app settings such as how many days a resolved complaint can be reopened.',
    'pgr-escalation': 'When an unresolved complaint is escalated to a supervisor.',
    'map-config': 'The map shown when a citizen pins a complaint location.',
  } },
  { id: 'people', title: 'People', blurb: 'The choices offered on employee forms.', items: {
    'employee-type': 'Kinds of employment (permanent, contract, ...).',
    'employee-status': 'Employment states (employed, retired, ...).',
    'deactivation-reasons': 'Reasons offered when an employee is deactivated.',
    'gender-types': 'Genders offered on employee and citizen forms.',
    'degrees': 'Qualifications offered on the employee form.',
    'specializations': 'Specialisations offered with a qualification.',
    'employment-tests': 'Departmental tests offered on the employee form.',
  } },
  { id: 'look', title: 'Look and feel', blurb: 'What citizens and employees see on the home pages.', items: {
    'state-info': 'The name, logo and languages of this installation.',
    'ui-homepage': 'The cards on the citizen home page.',
    'theme-config': 'Colours and fonts of the citizen and employee apps.',
  } },
  { id: 'dashboards', title: 'Dashboards', blurb: 'The figures on the complaint dashboards.', items: {
    'dashboard-packs': 'Which dashboards exist and the charts on each.',
    'kpi-definitions': 'How each dashboard figure is calculated.',
  } },
  { id: 'notifications', title: 'Notifications', blurb: 'The messages sent when a complaint changes.', items: {
    'notifications-event-catalogue': 'The events that can send a message.',
    'notifications-routing': 'Which event sends which message, to whom and how.',
    'notifications-template': 'The wording of each message.',
    'notifications-provider-template': 'Message wording registered with an SMS or email provider.',
    'notifications-channel': 'The ways messages are sent (SMS, email, ...).',
  } },
  { id: 'access', title: 'Access', blurb: 'Roles and what they may do. The Access screens are the usual way to change these.', items: {
    'roles': 'The roles that can be given to people.',
    'role-actions': 'Which API actions each role may call.',
  } },
  { id: 'platform', title: 'Platform', blurb: 'Installation-wide and legacy settings. Shown at the state only.', items: {
    'access-attributes': 'What access rules can be judged on (the attribute catalogue). For platform administrators.',
    'action-mappings': 'The API actions known to the access check.',
    'security-policy': 'Which personal fields are masked, and for whom.',
    'city-modules': 'Which modules each tenant has switched on.',
    'admin-console-schema': 'Templates for the bulk-upload admin console.',
    'form-validations': 'Validation rules for form fields such as postal codes.',
    'mobile-number-validation': 'The mobile number format accepted at sign-in.',
    'auto-escalation': 'Automatic escalation for workflows other than complaints.',
    'auto-escalation-ignore': 'Workflow states the automatic escalation skips.',
    'notification-routing': 'Legacy complaint notification routing (read only on 3.x).',
    'notification-template': 'Legacy complaint notification wording (read only on 3.x).',
    'notification-provider-template': 'Legacy provider message wording (read only on 3.x).',
    'notification-channel': 'Legacy notification channels (read only on 3.x).',
  } },
];

const PLATFORM = new Set(Object.keys(GROUPS.find((g) => g.id === 'platform')!.items));

/** True for a master offered at the state only. */
export function isPlatformOnly(name: string): boolean {
  return PLATFORM.has(name);
}

/** Entries that are screens rather than MDMS masters: their path and label. */
export const ADVANCED_LINKS: Record<string, { path: string; label: string }> = {
  'access-attributes': { path: '/manage/access/attributes', label: 'Access attributes' },
};

/** The masters by area, in GROUPS order; unknown ones go to "Other". atState = false leaves the Platform group out. */
export function groupAdvanced(names: string[], atState: boolean): AdvancedGroup[] {
  const left = new Set([...names, ...Object.keys(ADVANCED_LINKS)]);
  const out: AdvancedGroup[] = [];
  for (const g of GROUPS) {
    if (g.id === 'platform' && !atState) { for (const n of Object.keys(g.items)) left.delete(n); continue; }
    const items = Object.entries(g.items).filter(([n]) => left.has(n)).map(([name, description]) => ({ name, description }));
    for (const it of items) left.delete(it.name);
    if (items.length) out.push({ id: g.id, title: g.title, blurb: g.blurb, items });
  }
  if (left.size) out.push({ id: 'other', title: 'Other', blurb: 'Other lists.', items: [...left].map((name) => ({ name, description: '' })) });
  return out;
}
