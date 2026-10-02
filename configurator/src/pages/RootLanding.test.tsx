import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import RootLanding from './RootLanding';

/** Renders the dispatcher with a stand-in for the one identity entry point. */
function LoginTarget() {
  const location = useLocation();
  return <div>LOGIN{location.search}</div>;
}

const renderAt = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<RootLanding />} />
        <Route path="/login" element={<LoginTarget />} />
      </Routes>
    </MemoryRouter>,
  );

describe('root identity landing', () => {
  it('preserves an opaque callback result while routing to sign-in', () => {
    renderAt('/?authResult=result-1');
    expect(screen.getByText('LOGIN?authResult=result-1')).toBeInTheDocument();
  });
});
