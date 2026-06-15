// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Proves the component test harness is wired: jsdom environment is active, Testing Library
// renders, and the jest-dom matchers are registered. Downstream component tests (U1, U4) rely
// on exactly this setup.
describe('test harness', () => {
  it('renders a React element into jsdom and finds it', () => {
    render(<div>ok</div>);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
