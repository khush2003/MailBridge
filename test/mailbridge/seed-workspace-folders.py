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
    draft_id = hashlib.sha1(f'{account_id}:ui-draft'.encode()).hexdigest()
    draft = {'__cls': 'Message', 'aid': account_id, 'id': draft_id, 'v': 1,
             'hMsgId': 'mailbridge-ui-draft@example.test', 'subject': 'Saved draft interface review',
             'date': 1791420300, 'draft': True, 'unread': False, 'starred': False,
             'from': [{'email': 'test@example.test', 'name': 'Offline workspace fixture'}],
             'to': [{'email': 'recipient@example.test', 'name': 'Recipient'}],
             'cc': [], 'bcc': [], 'replyTo': [], 'files': [], 'labels': [], 'folders': {},
             'snippet': 'Saved draft body', 'threadId': 'ui-draft-thread', 'plaintext': False}
    db.execute('INSERT OR IGNORE INTO Message (id, accountId, version, data, headerMessageId, '
               'subject, date, draft, unread, starred, threadId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
               (draft_id, account_id, 1, json.dumps(draft), draft['hMsgId'], draft['subject'],
                draft['date'], 1, 0, 0, draft['threadId']))
    db.execute('INSERT OR IGNORE INTO MessageBody (id, value) VALUES (?, ?)',
               (draft_id, '<p>Saved draft body</p>'))
