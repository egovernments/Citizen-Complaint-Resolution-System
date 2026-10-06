import { Link } from 'react-router-dom';
import { useLocaleState, useLocales } from 'ra-core';
import { ExternalLink, Globe, HelpCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTheme } from '@/providers/ThemeProvider';
import { THEMES } from '@/themes';
import { trackEvent } from '@/lib/telemetry';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
    <Select
      value={locale}
      onValueChange={(next) => {
        trackEvent('locale_change', { from: locale, to: next });
        setLocale(next);
      }}
    >
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
    <Select
      value={theme}
      onValueChange={(next) => {
        trackEvent('theme_change', { from: theme, to: next });
        setTheme(next);
      }}
    >
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
 * The signed-in user as the DIGIT console shows them: an initial in a circle
 * at the top bar's end, opening their name, the docs and Sign out.
 */
export function AccountMenu({
  name,
  tenant,
  accountLabel,
  docsLabel,
  signOutLabel,
  onSignOut,
}: {
  name?: string;
  tenant: string;
  accountLabel: string;
  docsLabel: string;
  signOutLabel: string;
  onSignOut: () => void;
}) {
  const initial = name?.trim().charAt(0).toUpperCase() || '?';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={accountLabel}
          className="ml-1 w-9 h-9 rounded-full bg-secondary text-secondary-foreground text-sm font-medium flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      {/* Radix focuses the menu box itself on open; the app-wide focus ring
          would outline the whole menu, so it keeps its plain shadow and the
          items carry the keyboard highlight. */}
      <DropdownMenuContent align="end" sideOffset={6} className="w-52 focus-visible:shadow-md">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium text-foreground truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{tenant}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild><Link to="/account">Your account</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link to="/members">Members</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link to="/workspace-settings">Workspace settings</Link></DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuItem asChild>
          <a
            href="https://docs.digit.org"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent('docs_click', { from: 'account_menu' })}
          >
            <ExternalLink />
            {docsLabel}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut />
          {signOutLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
