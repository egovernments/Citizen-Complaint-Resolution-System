import { useLocaleState, useLocales } from 'ra-core';
import { ExternalLink, Globe, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTheme } from '@/providers/ThemeProvider';
import { THEMES } from '@/themes';
import { DigitFooter } from '@/components/DigitFooter';

/** Help as the console draws it: a quiet text button, icon-only on a phone. */
export function HelpButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={label}
      className="h-8 gap-1.5 px-2 text-sm font-normal text-foreground hover:bg-muted hover:text-foreground"
    >
      <HelpCircle />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// LocaleSwitcher — compact dropdown using ra-core hooks
// ---------------------------------------------------------------------------
export function LocaleSwitcher() {
  const [locale, setLocale] = useLocaleState();
  const locales = useLocales();

  if (!locales || locales.length <= 1) return null;

  return (
    <Select value={locale} onValueChange={setLocale}>
      <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm text-foreground shadow-none hover:bg-muted">
        <Globe className="w-4 h-4 flex-shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((l) => (
          <SelectItem key={l.locale} value={l.locale} className="text-xs">
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// ThemeSwitcher — compact dropdown with color swatch previews
// ---------------------------------------------------------------------------
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const currentTheme = THEMES.find((t) => t.name === theme);

  return (
    <Select value={theme} onValueChange={setTheme}>
      <SelectTrigger className="h-8 w-auto gap-1.5 border-0 bg-transparent px-2 text-sm text-foreground shadow-none hover:bg-muted">
        <span
          className="inline-block w-3 h-3 rounded-full border border-border flex-shrink-0"
          style={{ backgroundColor: currentTheme?.primaryHex }}
        />
        <span className="max-sm:sr-only">Theme</span>
      </SelectTrigger>
      <SelectContent>
        {THEMES.map((t) => (
          <SelectItem key={t.name} value={t.name} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: t.primaryHex }}
              />
              {t.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * "Powered by DIGIT" (CCRS#1841) and the docs link. Centred from sm up; on a
 * phone the spacer goes, so the logo and the link share the row unwrapped.
 */
export function AppFooter({ docsLabel }: { docsLabel: string }) {
  return (
    <footer className="flex-shrink-0 flex items-center justify-between gap-4 border-t border-border bg-card px-4 sm:px-6 py-2">
      <div className="hidden sm:block flex-1" />
      <DigitFooter />
      <div className="sm:flex-1 flex justify-end">
        <a
          href="https://docs.digit.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {docsLabel}
        </a>
      </div>
    </footer>
  );
}
