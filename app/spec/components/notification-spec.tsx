import React from 'react';
import { render, cleanup } from '@testing-library/react';
import Notification from '../../src/components/notification';

describe('Notification actions', () => {
  afterEach(cleanup);
  it('keeps one accessible dismiss action across repeated renders without mutating supplied actions', () => {
    const actions = [{ label: 'Retry', fn: () => {} }];
    const view = render(<Notification title="Connection issue" actions={actions} isDismissable />);
    for (let n = 0; n < 3; n++) {
      view.rerender(<Notification title="Connection issue" actions={actions} isDismissable />);
      expect(view.container.querySelectorAll('button.action').length).toBe(2);
      expect(actions.length).toBe(1);
      expect(view.getByRole('button', { name: 'Dismiss', hidden: true })).toBeTruthy();
    }
  });
});
