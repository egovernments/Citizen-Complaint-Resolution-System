import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavRow } from './rail';

// cfgreview F27 (#1573) / F22 (#1568): rail rows are links with a URL, and always named.
describe('NavRow', () => {
  it('is a link to its page; a plain click runs the row handler, a ctrl-click is left to the browser', () => {
    const onClick = vi.fn();
    render(<MemoryRouter><NavRow label="Departments" active={false} collapsed={false} onClick={onClick} to="/manage/departments" /></MemoryRouter>);
    const a = screen.getByRole('link', { name: 'Departments' });
    expect(a.getAttribute('href')).toBe('/manage/departments');
    fireEvent.click(a);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(a, { ctrlKey: true });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('keeps its name when collapsed, and stays a button without a page', () => {
    render(<MemoryRouter><NavRow label="Advanced" active={false} collapsed onClick={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeTruthy();
  });
});
