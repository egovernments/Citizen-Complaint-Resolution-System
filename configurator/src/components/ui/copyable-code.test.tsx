import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyableCode } from './copyable-code';

describe('CopyableCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the value', () => {
    render(<CopyableCode value="GarbageNotCollected" />);
    expect(screen.getByText('GarbageNotCollected')).toBeInTheDocument();
  });

  it('copies the value to the clipboard when the copy button is clicked', async () => {
    render(<CopyableCode value="GarbageNotCollected" />);
    fireEvent.click(screen.getByLabelText('Copy GarbageNotCollected'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('GarbageNotCollected'),
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
