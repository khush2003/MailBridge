import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { AccountStore } from 'mailspring-exports';
import MailBridge from '../../../src/mailbridge/controller';
import ArchivePreferences from '../lib/preferences';

describe('Outlook PST import feedback', () => {
  beforeEach(() => {
    spyOn(MailBridge, 'outlookImportAvailable').andReturn(true);
    spyOn(MailBridge, 'peerSyncEnabled').andReturn(false);
    spyOn(MailBridge, 'settings').andReturn({ device: 'test', peers: [] });
    spyOn(MailBridge, 'status').andReturn({ phase: 'local', peers: [], mailSyncInitialized: true });
  });
  afterEach(cleanup);

  it('selects a single destination account and shows progress next to the clicked button', async () => {
    spyOn(AccountStore, 'accounts').andReturn([
      { id: 'company', emailAddress: 'person@example.test' },
    ]);
    let finish;
    spyOn(MailBridge, 'importOutlook').andCallFake((id, progress) => {
      progress('Copying PST: 37%');
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const { getByRole, getByText } = render(<ArchivePreferences />);
    const button = getByRole('button', { name: 'Import Outlook PST' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    const args = (MailBridge.importOutlook as any).mostRecentCall.args;
    expect(args[0]).toBe('company');
    expect(typeof args[1]).toBe('function');
    expect(getByText('Copying PST: 37%').closest('section').textContent).toContain(
      'Import existing Outlook mail'
    );
    expect(button.disabled).toBe(true);
    expect(getByRole('button', { name: 'Cancel import' })).not.toBe(null);
    await act(async () => {
      finish({ count: 12, warnings: 1 });
    });
    expect(
      getByText('Imported 12 messages. 1 messages could not be exported; keep your original PST.')
    ).not.toBe(null);
    expect(button.disabled).toBe(false);
  });

  it('shows failures in the import section and enables retry', async () => {
    spyOn(AccountStore, 'accounts').andReturn([
      { id: 'company', emailAddress: 'person@example.test' },
    ]);
    spyOn(MailBridge, 'importOutlook').andCallFake(() =>
      Promise.reject(new Error('Outlook could not open this PST'))
    );
    const { getByRole } = render(<ArchivePreferences />);
    const button = getByRole('button', { name: 'Import Outlook PST' }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });
    const error = getByRole('alert');
    expect(error.textContent).toBe('Outlook could not open this PST');
    expect(error.closest('section').textContent).toContain('Import existing Outlook mail');
    expect(button.disabled).toBe(false);
  });

  it('explains how to enable import when multiple accounts need a destination choice', () => {
    spyOn(AccountStore, 'accounts').andReturn([
      { id: 'first', emailAddress: 'first@example.test' },
      { id: 'second', emailAddress: 'second@example.test' },
    ]);
    const { getByRole, getByText } = render(<ArchivePreferences />);
    const button = getByRole('button', { name: 'Import Outlook PST' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(getByText('Select a destination account to enable PST import.')).not.toBe(null);
    fireEvent.change(getByRole('combobox'), { target: { value: 'second' } });
    expect(button.disabled).toBe(false);
  });
});
