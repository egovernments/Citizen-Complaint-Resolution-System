// Icon whitelist for config-driven items (P1, CCSD-2006).
//
// MDMS items carry an `iconId` STRING (JSON can't hold a React component); the
// adapter maps it to a lucide component through this closed whitelist. Unknown
// / missing ids resolve to a safe fallback rather than crashing — config is
// untrusted input. Ids are the lucide export names, matching the icons the
// built-in content deck already uses (content.ts), so a seed row that mirrors a
// default renders the identical glyph.

import {
  FileText,
  Megaphone,
  Scale,
  ShieldAlert,
  Send,
  Hash,
  FileSearch,
  UserCheck,
  Search,
  CheckCircle2,
  Globe,
  Smartphone,
  MessageCircle,
  Phone,
  Landmark,
  Store,
} from "lucide-react";
import type { IconComponent } from "../content";

export const ICON_REGISTRY: Record<string, IconComponent> = {
  FileText,
  Megaphone,
  Scale,
  ShieldAlert,
  Send,
  Hash,
  FileSearch,
  UserCheck,
  Search,
  CheckCircle2,
  Globe,
  Smartphone,
  MessageCircle,
  Phone,
  Landmark,
  Store,
};

/** Fallback glyph for an unknown/absent iconId. */
export const FALLBACK_ICON: IconComponent = FileText;

/** Resolve an iconId string to a component; `fallback` (usually the matching
 *  default item's icon) wins over the generic FALLBACK_ICON. */
export function resolveIcon(iconId?: string, fallback?: IconComponent): IconComponent {
  if (iconId && ICON_REGISTRY[iconId]) return ICON_REGISTRY[iconId];
  return fallback ?? FALLBACK_ICON;
}
