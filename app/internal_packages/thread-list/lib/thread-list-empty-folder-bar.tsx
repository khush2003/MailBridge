import React from 'react';
import { ListensToFluxStore } from 'mailspring-component-kit';
import {
  localized,
  Folder,
  TaskQueue,
  ExpungeAllInFolderTask,
  FocusedPerspectiveStore,
  ThreadCountsStore,
} from 'mailspring-exports';

interface ThreadListEmptyFolderBarProps {
  role: string;
  folders: Folder[];
  count: number;
  busy: boolean;
}

class ThreadListEmptyFolderBar extends React.Component<ThreadListEmptyFolderBarProps> {
  static displayName = 'ThreadListEmptyFolderBar';

  render() {
    const { role, count } = this.props;
    if (!role || count === 0) {
      return false;
    }
    const term = role === 'trash' ? localized('Deleted').toLocaleLowerCase() : role;

    return (
      <div className="thread-list-empty-folder-bar">
        <div className="notice">
          {count > 1
            ? localized(`Showing %@ threads with %@ messages`, (count / 1).toLocaleString(), term)
            : localized(`Showing 1 thread with %@ messages`, term)}
        </div>
        <div className="notice">
          Server cleanup is available in webmail. Retained copies stay on this PC.
        </div>
      </div>
    );
  }
}

export default ListensToFluxStore(ThreadListEmptyFolderBar, {
  stores: [TaskQueue, ThreadCountsStore, FocusedPerspectiveStore],
  getStateFromStores: (props) => {
    const p = FocusedPerspectiveStore.current();
    const folders = (p && p.categories()) || [];

    if (
      !folders.length ||
      !folders.every((c) => c instanceof Folder && (c.role === 'trash' || c.role === 'spam'))
    ) {
      return { role: null, folders: null };
    }

    return {
      folders,
      role: folders[0].role,
      busy: TaskQueue.findTasks(ExpungeAllInFolderTask).some((t) =>
        folders.map((f) => f.accountId).includes(t.accountId)
      ),
      count: folders.reduce(
        (sum, { id }) => sum + ThreadCountsStore.totalCountForCategoryId(id),
        0
      ),
    };
  },
});
