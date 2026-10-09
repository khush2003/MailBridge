import _ from 'underscore';
import MailspringStore from 'mailspring-store';
import DatabaseStore from './database-store';
import { Thread } from '../models/thread';

interface ThreadCountRow {
  categoryId: string;
  unread: number;
  total: number;
}

class ThreadCountsStore extends MailspringStore {
  _counts = {};

  constructor() {
    super();

    if (AppEnv.isMainWindow()) {
      // For now, unread counts are only retrieved in the main window.
      const onCountsChangedDebounced = _.throttle(this._onCountsChanged, 1000);
      DatabaseStore.listen((change) => {
        if (change.objectClass === Thread.name) {
          onCountsChangedDebounced();
        }
      });
      onCountsChangedDebounced();
    }
  }

  _onCountsChanged = () => {
    Promise.all([
      DatabaseStore._query('SELECT * FROM `ThreadCounts`'),
      DatabaseStore._query(`SELECT parent.id AS categoryId, COUNT(DISTINCT tc.id) AS total,
        COUNT(DISTINCT CASE WHEN tc.unread > 0 THEN tc.id END) AS unread
        FROM Folder parent JOIN Folder child ON child.accountId = parent.accountId AND
          (child.id = parent.id OR (json_extract(child.data, '$.mailbridgeLocal') = 1 AND
            json_extract(child.data, '$.mailbridgeSource') = parent.path))
        JOIN ThreadCategory tc ON tc.value = child.id
        WHERE json_extract(parent.data, '$.mailbridgeLocal') IS NOT 1
        GROUP BY parent.id`),
    ]).then(([base, represented]) => {
      const results: ThreadCountRow[] = [...base, ...represented].map(row => ({
        categoryId: String(row.categoryId), unread: Number(row.unread), total: Number(row.total),
      }));
      const nextCounts = {};
      for (const { categoryId, unread, total } of results) {
        nextCounts[categoryId] = { unread, total };
      }
      if (_.isEqual(nextCounts, this._counts)) {
        return;
      }
      this._counts = nextCounts;
      this.trigger();
    });
  };

  unreadCountForCategoryId(catId: string) {
    if (this._counts[catId] === undefined) {
      return null;
    }
    return this._counts[catId]['unread'];
  }

  totalCountForCategoryId(catId: string) {
    if (this._counts[catId] === undefined) {
      return null;
    }
    return this._counts[catId]['total'];
  }
}

export default new ThreadCountsStore();
