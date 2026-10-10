import React from 'react';
import fs from 'fs';
import classNames from 'classnames';

import Icon, { IconName } from '../../../src/mailbridge/icon';
import { Actions, PreferencesUIStoreTab, Utils, localized } from 'mailspring-exports';

interface PreferencesTabItemProps {
  selection: {
    accountId: string;
    tabId: string;
  };
  tabItem?: PreferencesUIStoreTab;
}

class PreferencesTabItem extends React.Component<PreferencesTabItemProps> {
  static displayName = 'PreferencesTabItem';

  _onClick = () => {
    Actions.switchPreferencesTab(this.props.tabItem.tabId);
  };

  _onClickAccount = (event: React.MouseEvent, accountId: string) => {
    Actions.switchPreferencesTab(this.props.tabItem.tabId, { accountId });
    event.stopPropagation();
  };

  _onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._onClick();
    }
  };

  render() {
    const { selection, tabItem } = this.props;
    const { tabId, displayName } = tabItem;
    const classes = classNames({
      item: true,
      active: tabId === selection.tabId,
    });

    const icons: Record<string, IconName> = {
      General: 'settings',
      Accounts: 'mail',
      Archive: 'archive',
      Appearance: 'appearance',
      Shortcuts: 'keyboard',
      'Mail Rules': 'rules',
      'MCP Server': 'code',
      Folders: 'folder',
      Signatures: 'signature',
      Templates: 'template',
    };
    const icon = <Icon name={icons[tabId] || 'settings'} className="tab-icon" />;

    const isSelected = tabId === selection.tabId;
    return (
      <div
        className={classes}
        role="tab"
        aria-selected={isSelected}
        aria-label={displayName}
        tabIndex={isSelected ? 0 : -1}
        onClick={this._onClick}
        onKeyDown={this._onKeyDown}
      >
        {icon}
        <div className="name">{displayName}</div>
      </div>
    );
  }
}

interface PreferencesTabBarProps {
  tabs: PreferencesUIStoreTab[];
  selection: {
    accountId: string;
    tabId: string;
  };
}

class PreferencesTabsBar extends React.Component<PreferencesTabBarProps> {
  static displayName = 'PreferencesTabsBar';

  private _listRef = React.createRef<HTMLDivElement>();

  _onKeyDown = (e: React.KeyboardEvent) => {
    const { tabs, selection } = this.props;
    const currentIdx = tabs.findIndex((t) => t.tabId === selection.tabId);

    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIdx = (currentIdx + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    Actions.switchPreferencesTab(tabs[nextIdx].tabId);

    // Focus the newly activated tab (works even before React re-renders tabIndex)
    const tabEls = this._listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabEls?.[nextIdx]?.focus();
  };

  renderTabs() {
    return this.props.tabs.map((tabItem) => (
      <PreferencesTabItem key={tabItem.tabId} tabItem={tabItem} selection={this.props.selection} />
    ));
  }

  render() {
    return (
      <div className="container-preference-tabs">
        <div className="mb-settings-nav-title">Settings</div>
        <div
          ref={this._listRef}
          className="preferences-tabs"
          role="tablist"
          aria-orientation="vertical"
          aria-label={localized('Preferences tabs')}
          onKeyDown={this._onKeyDown}
        >
          {this.renderTabs()}
        </div>
      </div>
    );
  }
}

export default PreferencesTabsBar;
