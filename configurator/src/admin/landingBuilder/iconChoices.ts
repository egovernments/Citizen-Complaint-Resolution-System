/** Icon ids offered by the Builder — mirrors the runtime ICON_REGISTRY
 *  whitelist (digit-ui .../Landing/config/iconRegistry.ts). Unknown ids fall
 *  back safely at render, but the picker only offers the supported set. */
export const ICON_CHOICES: string[] = [
  'Lock', 'Hash', 'Bell',
  'FileText', 'Megaphone', 'Scale', 'ShieldAlert',
  'Send', 'FileSearch', 'UserCheck', 'Search', 'CheckCircle2',
  'Globe', 'Smartphone', 'MessageCircle', 'Phone',
  'Landmark', 'Store',
];
