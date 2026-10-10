import Icon from '../../../src/mailbridge/icon';
import React from 'react';
import path from 'path';
import fs from 'fs';
import { Flexbox, ConfigPropContainer } from 'mailspring-component-kit';
import { localized, AccountStore, Account } from 'mailspring-exports';

// NOTE: Temporarily copied from preferences module
class AppearanceModeOption extends React.Component<{
  mode: string;
  active: boolean;
  onClick: (e: React.MouseEvent<any>) => void;
}> {
  render() {
    let classname = 'appearance-mode';
    if (this.props.active) {
      classname += ' active';
    }

    const label = {
      list: localized('Reading Pane Off'),
      split: localized('Reading Pane On'),
    }[this.props.mode];

    return (
      <button
        type="button"
        className={classname}
        aria-pressed={this.props.active}
        onClick={this.props.onClick}
      >
        <Icon name="pane" />
        <div>{label}</div>
      </button>
    );
  }
}

class InitialPreferencesOptions extends React.Component<
  { account: Account; config?: any },
  { templates: any[] }
> {
  constructor(props) {
    super(props);
    this.state = { templates: [] };
    this._loadTemplates();
  }

  _loadTemplates = () => {
    const templatesDir = path.join(AppEnv.getLoadSettings().resourcePath, 'keymaps', 'templates');
    fs.readdir(templatesDir, (err, files) => {
      if (!files || !(files instanceof Array)) {
        return;
      }
      let templates = files.filter(
        (filename) => path.extname(filename) === '.cson' || path.extname(filename) === '.json'
      );
      templates = templates.map((filename) => path.parse(filename).name);
      this.setState({ templates });
      this._setConfigDefaultsForAccount(templates);
    });
  };

  _setConfigDefaultsForAccount = (templates: string[]) => {
    if (!this.props.account) {
      return;
    }

    const templateWithBasename = (name: string) => templates.find((t) => t.indexOf(name) === 0);

    if (this.props.account.provider === 'gmail') {
      this.props.config.set('core.workspace.mode', 'list');
      this.props.config.set('core.keymapTemplate', templateWithBasename('Gmail'));
    } else if (
      this.props.account.provider === 'eas' ||
      this.props.account.provider === 'office365' ||
      this.props.account.provider === 'outlook'
    ) {
      this.props.config.set('core.workspace.mode', 'split');
      this.props.config.set('core.keymapTemplate', templateWithBasename('Outlook'));
    } else {
      this.props.config.set('core.workspace.mode', 'split');
      if (process.platform === 'darwin') {
        this.props.config.set('core.keymapTemplate', templateWithBasename('Apple Mail'));
      } else {
        this.props.config.set('core.keymapTemplate', templateWithBasename('Outlook'));
      }
    }
  };

  render() {
    if (!this.props.config) {
      return false;
    }

    return (
      <div className="mb-setup-options">
        <div style={{ flex: 1 }}>
          <p>{localized('Choose your reading layout.')}</p>
          <Flexbox direction="row" style={{ alignItems: 'center' }}>
            {['list', 'split'].map((mode) => (
              <AppearanceModeOption
                mode={mode}
                key={mode}
                active={this.props.config.get('core.workspace.mode') === mode}
                onClick={() => this.props.config.set('core.workspace.mode', mode)}
              />
            ))}
          </Flexbox>
        </div>
        <div
          key="divider"
          style={{ marginLeft: 20, marginRight: 20, borderLeft: '1px solid #ccc' }}
        />
        <div style={{ flex: 1 }}>
          <p>
            {localized(
              `Choose familiar keyboard shortcuts. You can change these later in Settings.`
            )}
          </p>
          <select
            style={{ margin: 0 }}
            value={this.props.config.get('core.keymapTemplate')}
            onChange={(event) => this.props.config.set('core.keymapTemplate', event.target.value)}
          >
            {this.state.templates.map((template) => (
              <option key={template} value={template}>
                {template}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }
}

class InitialPreferencesPage extends React.Component<
  Record<string, unknown>,
  { account: Account }
> {
  static displayName = 'InitialPreferencesPage';

  _unlisten?: () => void;

  constructor(props) {
    super(props);
    this.state = { account: AccountStore.accounts()[0] };
  }

  componentDidMount() {
    this._unlisten = AccountStore.listen(this._onAccountStoreChange);
  }

  componentWillUnmount() {
    if (this._unlisten) {
      this._unlisten();
    }
  }

  _onAccountStoreChange = () => {
    this.setState({ account: AccountStore.accounts()[0] });
  };

  render() {
    if (!this.state.account) {
      return <div />;
    }
    return (
      <div className="page opaque initial-preferences">
        <h1>{localized(`Welcome to MailBridge`)}</h1>
        <p className="prompt">{localized(`Let's set things up to your liking.`)}</p>
        <ConfigPropContainer>
          <InitialPreferencesOptions account={this.state.account} />
        </ConfigPropContainer>
        <button className="btn btn-large btn-emphasis" onClick={this._onFinished}>
          {localized(`Looks Good!`)}
        </button>
      </div>
    );
  }

  _onFinished = () => {
    require('electron').ipcRenderer.send('account-setup-successful');
  };
}

export default InitialPreferencesPage;
