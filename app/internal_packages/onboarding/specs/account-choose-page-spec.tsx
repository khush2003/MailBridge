import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import AccountChoosePage from '../lib/page-account-choose';
import * as OnboardingActions from '../lib/onboarding-actions';

describe('Account provider keyboard activation', () => {
  afterEach(cleanup);

  for (const key of ['Enter', ' ']) {
    it(`chooses the focused provider with ${key === ' ' ? 'Space' : key}`, () => {
      spyOn(OnboardingActions, 'chooseAccountProvider');
      const { getByRole } = render(<AccountChoosePage />);
      const provider = getByRole('button', { name: 'IMAP / SMTP' });
      provider.focus();
      fireEvent.keyDown(provider, { key });
      expect(OnboardingActions.chooseAccountProvider).toHaveBeenCalledWith('imap');
    });
  }
});
