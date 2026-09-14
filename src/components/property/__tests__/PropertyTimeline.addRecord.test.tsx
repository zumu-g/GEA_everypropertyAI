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
