// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EditableStat } from '../PropertyProfile';

afterEach(cleanup);

// Behavioural guard for the touch affordance fix (U4): the edit control must be a real,
// accessible, clickable element present at rest — not hover-gated and invisible to touch.
// We assert via accessible role/name and a click firing onEdit, NOT via Tailwind class strings
// (jsdom has no layout/hover engine; class assertions would be tautological).
const baseProps = {
  field: 'bedrooms',
  value: '4',
  label: 'Beds',
  editingField: null,
  editValue: '',
  editSaving: false,
  onEdit: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
  onEditValueChange: vi.fn(),
};

describe('EditableStat edit affordance', () => {
  it('renders an accessible edit control at rest (not editing)', () => {
    render(<EditableStat {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Edit Beds' })).toBeInTheDocument();
  });

  it('invokes onEdit when the control is activated (reachable without hover)', () => {
    const onEdit = vi.fn();
    render(<EditableStat {...baseProps} onEdit={onEdit} />);
    screen.getByRole('button', { name: 'Edit Beds' }).click();
    expect(onEdit).toHaveBeenCalledWith('bedrooms', '4');
  });
});
