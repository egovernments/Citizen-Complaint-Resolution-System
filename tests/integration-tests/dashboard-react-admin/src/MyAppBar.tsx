/**
 * Custom AppBar — RUN button + the standard react-admin light/dark toggle.
 * The earlier multi-theme picker was removed (we ship Nano only).
 */
import { AppBar, TitlePortal, ToggleThemeButton } from 'react-admin';
import RunButton from './RunButton';

export default function MyAppBar() {
  return (
    <AppBar
      toolbar={
        <>
          <RunButton />
          <ToggleThemeButton />
        </>
      }
    >
      <TitlePortal />
    </AppBar>
  );
}
