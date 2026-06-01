/**
 * Single named theme — react-admin's Nano (light + dark variants). The
 * standard light/dark toggle in the AppBar still flips between them.
 * Earlier we exposed a multi-theme picker, but Nano is what we ship; the
 * picker is removed.
 */
import { nanoLightTheme, nanoDarkTheme } from 'react-admin';
import type { RaThemeOptions } from 'react-admin';

export interface NamedTheme {
  name: string;
  light: RaThemeOptions;
  dark: RaThemeOptions;
}

export const NANO: NamedTheme = {
  name: 'nano',
  light: nanoLightTheme,
  dark: nanoDarkTheme,
};
