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

describe('PropertyTimeline — add record', () => {
  it('shows no add form without onAdd', () => {
    render(<PropertyTimeline sales={[]} rentals={[]} />);
    expect(screen.queryByText('Add a sale or lease record')).toBeNull();
  });

  it('submits a lease record and closes the form', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<PropertyTimeline sales={[]} rentals={[]} onAdd={onAdd} />);

    fireEvent.click(screen.getByText('Add a sale or lease record'));
    fireEvent.change(screen.getByLabelText('Record'), { target: { value: 'rental' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Weekly rent ($)'), { target: { value: '$650' } });
    fireEvent.change(screen.getByLabelText('Agency (optional)'), { target: { value: 'Grants EA' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add property record' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ kind: 'rental', date: '2026-08-01', amount: 650, agency: 'Grants EA' });
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('surfaces a save failure instead of closing', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Sign in to add property records'));
    render(<PropertyTimeline sales={[{ date: '2020-01-01', price: 500000 }]} rentals={[]} onAdd={onAdd} />);

    fireEvent.click(screen.getByText('Add a sale or lease record'));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Sale price ($)'), { target: { value: '850000' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add property record' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to add property records');
    expect(screen.getByRole('form')).toBeTruthy();
  });
});

describe('PropertyTimeline — paste history', () => {
  it('parses pasted text, ticks storable rows, and saves each via onAdd', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onParse = vi.fn().mockResolvedValue([
      { kind: 'sale', date: '2013-01-10', amount: 450000, agency: "Grant's Estate Agents - Berwick" },
      { kind: 'listing', date: '2013-01-07' },
      { kind: 'sale', date: '2004-05-29', amount: 165000 },
    ]);
    render(<PropertyTimeline sales={[]} rentals={[]} onAdd={onAdd} onParse={onParse} />);

    fireEvent.click(screen.getByText('Add a sale or lease record'));
    fireEvent.click(screen.getByRole('tab', { name: 'Paste history' }));
    fireEvent.change(screen.getByLabelText(/Paste the property history/), { target: { value: 'Sold $450,000 10 Jan 2013' } });
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
