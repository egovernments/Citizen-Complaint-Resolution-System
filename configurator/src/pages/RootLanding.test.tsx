import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import RootLanding from './RootLanding';

/** Renders the dispatcher with a stand-in for the one identity entry point. */
const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootLanding />} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('root identity landing', () => {
  it('uses the sign-in journey as the single root dispatcher', () => {
    renderAt();
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });
});
