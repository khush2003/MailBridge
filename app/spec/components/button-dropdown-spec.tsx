import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ButtonDropdown } from '../../src/components/button-dropdown';

describe('ButtonDropdown keyboard access', () => {
  afterEach(cleanup);
  it('opens and closes a menu-only control with the keyboard and reports its state', () => {
    const view = render(
      <ButtonDropdown
        primaryTitle="Signature options"
        primaryItem={<span>Signature</span>}
        menu={<span>Menu content</span>}
      />
    );
    const button = view.getByRole('button', { name: 'Signature options', hidden: true });
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(button, { key: ' ' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
