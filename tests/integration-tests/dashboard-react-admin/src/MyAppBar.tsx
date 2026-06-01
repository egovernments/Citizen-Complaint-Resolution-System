/**
 * Custom AppBar — keeps just the standard react-admin light/dark toggle.
 * The earlier multi-theme picker was removed (we ship Nano only).
 */
import { AppBar, TitlePortal, ToggleThemeButton } from 'react-admin';

export default function MyAppBar() {
  return (
    <AppBar toolbar={<ToggleThemeButton />}>
      <TitlePortal />
    </AppBar>
  );
}
