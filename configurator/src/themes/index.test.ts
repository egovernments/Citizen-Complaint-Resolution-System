import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, applyThemeVariables, getStoredTheme, THEME_STORAGE_KEY } from './index';

describe('saved theme', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to CMS Blue and ignores the old auto-saved key', () => {
    // Written on every load while DIGIT Orange was the default; not a choice.
    window.localStorage.setItem('digit-theme', 'digit-orange');
    expect(getStoredTheme()).toBe('cms-blue');
  });

  it('remembers an explicit pick, and only that', () => {
    applyThemeVariables('digit-orange');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    applyTheme('digit-orange');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('digit-orange');
    expect(getStoredTheme()).toBe('digit-orange');
  });

  it('falls back to CMS Blue for a preset that no longer exists', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'retired-preset');
    expect(getStoredTheme()).toBe('cms-blue');
  });
});
