import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyableCode } from './copyable-code';

describe('CopyableCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders short values in full', () => {
    render(<CopyableCode value="GARB" />);
    expect(screen.getByText('GARB')).toBeInTheDocument();
  });

  it('shortens long values with an ellipsis (the visible text differs from the full value)', () => {
    const long = 'PUBLIC_STREET_LIGHT_NOT_WORKING_AT_NIGHT';
    render(<CopyableCode value={long} maxChars={20} />);
    expect(screen.queryByText(long)).not.toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
  });

  it('copies the full value even when the display is shortened', async () => {
    const long = 'PUBLIC_STREET_LIGHT_NOT_WORKING_AT_NIGHT';
    render(<CopyableCode value={long} maxChars={20} />);
    fireEvent.click(screen.getByLabelText(`Copy ${long}`));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(long),
    );
  });

  it('does not toggle a parent row click when copying', () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <CopyableCode value="X" />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Copy X'));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('hides the copy button when showCopy is false', () => {
    render(<CopyableCode value="X" showCopy={false} />);
    expect(screen.queryByLabelText('Copy X')).not.toBeInTheDocument();
  });
});
