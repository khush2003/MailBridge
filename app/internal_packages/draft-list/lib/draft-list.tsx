import React from 'react';
import ReactDOM from 'react-dom';
import { showMailBridgeMenu } from '../../../src/mailbridge/context-menu';
import { Actions, Message } from 'mailspring-exports';
import {
  FluxContainer,
  FocusContainer,
  EmptyListState,
  MultiselectList,
} from 'mailspring-component-kit';
import DraftListStore from './draft-list-store';
import * as DraftListColumns from './draft-list-columns';

class DraftList extends React.Component {
  static displayName = 'DraftList';
  static containerRequired = false;
  componentDidMount() {
    ReactDOM.findDOMNode(this).addEventListener('contextmenu', this.contextMenu);
  }
  componentWillUnmount() {
    ReactDOM.findDOMNode(this).removeEventListener('contextmenu', this.contextMenu);
  }
  contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    const drafts = (this.refs.list as MultiselectList).itemsForMouseEvent(event) as Message[];
    if (!drafts?.length) return;
    showMailBridgeMenu(
      [
        {
          label: 'Open draft',
          icon: 'edit',
          enabled: drafts.length === 1 && !(drafts[0] as any).uploadTaskId,
          click: () => this._onDoubleClick(drafts[0]),
        },
        { type: 'separator' },
        {
          label: 'Delete drafts',
          icon: 'delete',
          enabled: drafts.every((draft) => !(draft as any).uploadTaskId),
          click: () => drafts.forEach((draft) => Actions.destroyDraft(draft)),
        },
      ],
      { x: event.clientX, y: event.clientY }
    );
  };

  render() {
    return (
      <FluxContainer
        stores={[DraftListStore]}
        getStateFromStores={() => {
          return { dataSource: DraftListStore.dataSource() };
        }}
      >
        <FocusContainer collection="draft">
          <MultiselectList
            ref="list"
            className="draft-list"
            columns={DraftListColumns.Wide}
            onDoubleClick={this._onDoubleClick}
            EmptyComponent={EmptyListState}
            keymapHandlers={this._keymapHandlers()}
            itemPropsProvider={this._itemPropsProvider}
            itemHeight={39}
          />
        </FocusContainer>
      </FluxContainer>
    );
  }
  _itemPropsProvider = (draft: Message) => {
    const props: any = {};
    if ((draft as any).uploadTaskId) {
      props.className = 'sending';
    }
    return props;
  };

  _keymapHandlers = () => {
    return {
      'core:delete-item': this._onRemoveFromView,
      'core:gmail-remove-from-view': this._onRemoveFromView,
      'core:remove-from-view': this._onRemoveFromView,
    };
  };

  _onDoubleClick = (draft: Message) => {
    if (!(draft as any).uploadTaskId) {
      Actions.composePopoutDraft(draft.headerMessageId);
    }
  };

  _onRemoveFromView = () => {
    for (const draft of DraftListStore.dataSource().selection.items()) {
      Actions.destroyDraft(draft);
    }
  };
}

export default DraftList;
