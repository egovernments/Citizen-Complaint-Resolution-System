import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateThemeConfigToV3 } from './themeConfigMigration.js';

// The actual active theme record on bomet (common-masters.ThemeConfig,
// uniqueIdentifier "bomet-county", version "1") — a v1 record carrying a few
// stray flat keys. This is the exact shape that loads blank in the editor today.
const BOMET_V1 = {
  code: 'bomet-county',
  name: 'Bomet County Blue',
  version: '1',
  colors: {
    grey: { bg: '#E6E6E6', light: '#FAFAFA', lighter: '#F2F2F2', disabled: '#C5C5C5' },
    link: { hover: '#1565A8', normal: '#1B85D2' },
    text: { muted: '#787878', heading: '#1565A8', primary: '#1D2433', secondary: '#5F5C62' },
    error: '#E02D3A',
    border: '#D6D5D4',
    digitv2: {
      'chart-1': '#1B85D2',
      'chart-2': '#E5202A',
      'chart-3': '#128F21',
      'chart-4': '#FEC931',
      'chart-5': '#F58831',
      'alert-info': '#1B85D2',
      'primary-bg': '#E3F0FA',
      'header-sidenav': '#1B85D2',
      'text-color-disabled': '#B1B4B6',
    },
    primary: { dark: '#1565A8', main: '#1B85D2', light: '#E3F0FA', accent: '#E5202A', 'selected-bg': '#E3F0FA' },
    success: '#128F21',
    'input-border-focus': '#1B85D2',
    'sidebar-selected-bg': '#093B50',
    'button-primary-bg-default': '#1B85D2',
  },
};

describe('migrateThemeConfigToV3', () => {
  it('resolves v3 brand/text fields from a v1 record (bomet-county)', () => {
    const out = migrateThemeConfigToV3(BOMET_V1) as typeof BOMET_V1;
    const c = out.colors as Record<string, string>;
    // primary-1 canonical source is primary.dark
    assert.equal(c['primary-1'], '#1565A8');
    // primary-2 from primary.main
    assert.equal(c['primary-2'], '#1B85D2');
    assert.equal(c['text-heading'], '#1565A8');
    assert.equal(c['text-primary'], '#1D2433');
    assert.equal(c['text-secondary'], '#5F5C62');
    // primary-1-bg from primary.selected-bg
    assert.equal(c['primary-1-bg'], '#E3F0FA');
    assert.equal(out.version, '3');
  });

  it('prefers existing flat v3-ish keys over derived legacy values', () => {
    const c = (migrateThemeConfigToV3(BOMET_V1) as typeof BOMET_V1).colors as Record<string, string>;
    assert.equal(c['button-primary-bg-default'], '#1B85D2');
    assert.equal(c['input-border-focus'], '#1B85D2');
    assert.equal(c['sidebar-selected-bg'], '#093B50');
  });

  it('maps charts from digitv2.chart-N', () => {
    const c = (migrateThemeConfigToV3(BOMET_V1) as typeof BOMET_V1).colors as Record<string, string>;
    assert.equal(c['chart-1'], '#1B85D2');
    assert.equal(c['chart-5'], '#F58831');
  });

  it('retains original legacy keys (lossless)', () => {
    const c = (migrateThemeConfigToV3(BOMET_V1) as typeof BOMET_V1).colors as Record<string, unknown>;
    assert.deepEqual(c.primary, BOMET_V1.colors.primary);
    assert.equal((c.text as Record<string, string>).heading, '#1565A8');
  });

  it('fans out v2 semantic records', () => {
    const v2 = {
      code: 't', name: 'T', version: '2',
      colors: { brand: '#AA0000', 'brand-on': '#FFFFFF', 'text-primary': '#111111' },
    };
    const c = (migrateThemeConfigToV3(v2) as typeof v2).colors as Record<string, string>;
    assert.equal(c['primary-2'], '#AA0000'); // brand → --color-primary-main → primary-2
    assert.equal(c['primary-1'], '#FFFFFF'); // brand-on → --color-primary-dark → primary-1
    assert.equal(c['text-primary'], '#111111');
  });

  it('is idempotent for records already in v3', () => {
    const v3 = { code: 'g', name: 'G', version: '3', colors: { 'primary-1': '#006B3F', 'primary-2': '#FEC931' } };
    const out = migrateThemeConfigToV3(v3);
    assert.strictEqual(out, v3); // untouched, same reference
  });

  it('leaves non-theme / malformed data alone', () => {
    assert.deepEqual(migrateThemeConfigToV3({ code: 'x' }), { code: 'x' });
    assert.deepEqual(migrateThemeConfigToV3({ colors: [] as unknown }), { colors: [] });
  });
});
