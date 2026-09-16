import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DigitFooter } from './DigitFooter';

/**
 * The attribution has to survive the two states that produced #1836: a config
 * key that is absent (the configurator's normal state — it loads no
 * globalConfigs script) and one that is present but blank.
 */

type ConfigWindow = Window & {
  globalConfigs?: { getConfig?: (key: string) => unknown };
};

function setConfig(byKey: Record<string, unknown>) {
  (window as ConfigWindow).globalConfigs = { getConfig: (key) => byKey[key] };
}

afterEach(() => {
  delete (window as ConfigWindow).globalConfigs;
  cleanup();
});

describe('DigitFooter', () => {
  it('renders the bundled lockup when globalConfigs is absent (the stock install)', () => {
    render(<DigitFooter />);
    const img = screen.getByAltText('Powered by DIGIT');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBeTruthy();
  });

  it('renders nothing when the deployment explicitly blanks the config', () => {
    setConfig({ DIGIT_FOOTER: '' });
    const { container } = render(<DigitFooter />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByAltText('Powered by DIGIT')).toBeNull();
  });

  it('prefers a configured logo over the bundled one', () => {
    setConfig({ DIGIT_FOOTER: 'https://cdn.example.org/custom-footer.png' });
    render(<DigitFooter />);
    expect(screen.getByAltText('Powered by DIGIT')).toHaveAttribute(
      'src',
      'https://cdn.example.org/custom-footer.png',
    );
  });

  it('selects the bw lockup independently of the colour one', () => {
    setConfig({ DIGIT_FOOTER_BW: 'https://cdn.example.org/bw.png' });
    render(<DigitFooter variant="bw" />);
    expect(screen.getByAltText('Powered by DIGIT')).toHaveAttribute(
      'src',
      'https://cdn.example.org/bw.png',
    );
  });

  it('falls back to the bundled asset when the config value is not a string', () => {
    setConfig({ DIGIT_FOOTER: { url: 'nope' } });
    render(<DigitFooter />);
    expect(screen.getByAltText('Powered by DIGIT').getAttribute('src')).toBeTruthy();
  });

  it('links to DIGIT_HOME_URL when set, and to the default otherwise', () => {
    render(<DigitFooter />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://egov.org.in/digit/');
    cleanup();

    setConfig({ DIGIT_HOME_URL: 'https://digit.example.org' });
    render(<DigitFooter />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://digit.example.org');
  });
});
