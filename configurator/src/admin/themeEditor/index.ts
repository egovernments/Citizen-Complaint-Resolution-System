import type { ComponentType } from 'react';
import { ThemeConfigEditor } from './ThemeConfigEditor';
import { StateInfoEditor } from './StateInfoEditor';
import { MapConfigEditor } from './MapConfigEditor';
import { LandingBuilder } from '../landingBuilder';

/**
 * Registry of custom editors keyed by the `customEditor` field on
 * SchemaDescriptor. MdmsResourceEdit consults this map; when a key is set
 * and resolves, the generic form is bypassed in favor of the custom one.
 *
 * Keep this map tiny — custom editors are the exception, not the rule.
 * Every schema that can be served by the descriptor + widget system should
 * stay on that path.
 */
export const customEditors: Record<string, ComponentType> = {
  'theme-config': ThemeConfigEditor,
  // StateInfo's languages array is the only knob that controls the locales
  // available across the configurator AND the digit-ui language switcher.
  // The descriptor + LocaleListInput render fine through the generic form,
  // but the schema-driven save path silently swallows the submit on this
  // resource (filed separately). The custom editor calls mdmsUpdate
  // directly so save is reliable.
  'state-info': StateInfoEditor,
  // Grouped sections + a live map preview + a basemap dropdown; the generic
  // form rendered 12 stacked full-width inputs with paragraph help.
  'map-config': MapConfigEditor,
  // P4 (CCSD-2009): row edit on landing-sections opens the visual Builder
  // pre-selected on that section — same resource, routes and MDMS APIs as the
  // P3 generic CRUD (which stays available for list/show/audit).
  'landing-builder': LandingBuilder,
};

export { ThemeConfigEditor, StateInfoEditor, MapConfigEditor };
