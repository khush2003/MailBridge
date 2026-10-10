"""Add empty nested folders to an isolated offline UI fixture before launching it."""
import hashlib
import json
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as db:
    account_id = sys.argv[2]
    for folder_path in ('Projects', 'Projects/Design', 'Projects/Design/Review'):
        folder_id = hashlib.sha1(f'{account_id}:{folder_path}'.encode()).hexdigest()
        data = {'__cls': 'Folder', 'aid': account_id, 'id': folder_id,
                'path': folder_path, 'role': '', 'v': 1,
                'localStatus': {'busy': False, 'syncedMinUID': 1,
                                'messageCount': 0, 'unseenCount': 0}}
        db.execute('INSERT OR IGNORE INTO Folder (id, accountId, version, data, path, role) '
                   'VALUES (?, ?, ?, ?, ?, ?)',
                   (folder_id, account_id, 1, json.dumps(data), folder_path, ''))
