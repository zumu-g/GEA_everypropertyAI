// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PropertyTimeline } from '../PropertyTimeline';

afterEach(cleanup);

// jsdom has no matchMedia; the timeline reads prefers-reduced-motion on render.
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}));

describe('PropertyTimeline — paste history', () => {
  it('shows no add box without onAdd/onParse', () => {
    render(<PropertyTimeline sales={[]} rentals={[]} />);
    expect(screen.queryByText('Add sale or lease records')).toBeNull();
  });

  it('surfaces a save failure with progress instead of closing', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Sign in to add property records'));
    const onParse = vi.fn().mockResolvedValue([{ kind: 'sale', date: '2024-03-12', amount: 850000 }]);
    render(<PropertyTimeline sales={[]} rentals={[]} onAdd={onAdd} onParse={onParse} />);
    fireEvent.click(screen.getByText('Add sale or lease records'));
    fireEvent.change(screen.getByLabelText(/Sales and leases/), { target: { value: 'Sold $850,000 12 Mar 2024' } });
    fireEvent.click(screen.getByText('Parse'));
    fireEvent.click(await screen.findByText('Save 1 record'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to add property records (0 of 1 saved)');
    expect(screen.getByLabelText('Paste property history')).toBeTruthy();
  });

  it('parses pasted text, ticks storable rows, and saves each via onAdd', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onParse = vi.fn().mockResolvedValue([
      { kind: 'sale', date: '2013-01-10', amount: 450000, agency: "Grant's Estate Agents - Berwick" },
      { kind: 'listing', date: '2013-01-07' },
      { kind: 'sale', date: '2004-05-29', amount: 165000 },
    ]);
    render(<PropertyTimeline sales={[]} rentals={[]} onAdd={onAdd} onParse={onParse} />);

    fireEvent.click(screen.getByText('Add sale or lease records'));
    fireEvent.change(screen.getByLabelText(/Sales and leases/), { target: { value: 'Sold $450,000 10 Jan 2013' } });
    fireEvent.click(screen.getByText('Parse'));

    await waitFor(() => expect(onParse).toHaveBeenCalledWith('Sold $450,000 10 Jan 2013'));
    expect(await screen.findByText('Listed (not stored)')).toBeTruthy();
    expect(screen.getByLabelText('Save listing 2013-01-07')).toBeDisabled();

    fireEvent.click(screen.getByText('Save 2 records'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd).toHaveBeenNthCalledWith(1, { kind: 'sale', date: '2013-01-10', amount: 450000, agency: "Grant's Estate Agents - Berwick" });
    expect(onAdd).toHaveBeenNthCalledWith(2, { kind: 'sale', date: '2004-05-29', amount: 165000, agency: undefined });
    await waitFor(() => expect(screen.queryByLabelText('Paste property history')).toBeNull());
  });
});
