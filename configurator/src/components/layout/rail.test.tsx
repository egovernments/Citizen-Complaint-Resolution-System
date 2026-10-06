import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Inbox } from 'lucide-react';
import { NavExternalRow } from './rail';

const href = 'https://example.org/acme/digit-ui/employee';

it('opens another app in a new tab, without handing it this window', () => {
  render(<NavExternalRow icon={Inbox} label="Open complaint desk" href={href} collapsed={false} />);
  const link = screen.getByRole('link', { name: 'Open complaint desk' });
  expect(link.getAttribute('href')).toBe(href);
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
});

it('keeps its name as a tooltip and label when the rail is collapsed', () => {
  render(<NavExternalRow icon={Inbox} label="Open complaint desk" href={href} collapsed />);
  const link = screen.getByRole('link', { name: 'Open complaint desk' });
  expect(link.getAttribute('title')).toBe('Open complaint desk');
  expect(link.textContent).toBe('');
});
