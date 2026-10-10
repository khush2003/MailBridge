const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('clearing a new search returns to the folder it started from after navigation', () => {
  const inbox = { name: 'Inbox', accountIds: ['company'] };
  const sent = { name: 'Sent', accountIds: ['company'] };
  let current = inbox;
  class Store { listenTo() {} trigger() {} }
  class SearchPerspective {
    constructor(source, query) { this.sourcePerspective = source; this.searchQuery = query; this.accountIds = source.accountIds; }
  }
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('app/internal_packages/thread-search/lib/search-store.ts', 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'mailspring-store') return Store;
    if (name === './search-mailbox-perspective') return SearchPerspective;
    if (name === 'mailspring-exports') return {
      FocusedPerspectiveStore: { current: () => current }, AccountStore: { accounts: () => [] },
      Actions: { focusMailboxPerspective: perspective => { current = perspective; } },
    };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const store = exports.default;
  store._onQuerySubmitted('invoice');
  assert.equal(current.sourcePerspective, inbox);
  current = sent;
  store._onPerspectiveChanged();
  assert.equal(store.isSearching(), false);
  store._onQuerySubmitted('report');
  assert.equal(current.sourcePerspective, sent);
  store._onQuerySubmitted('');
  assert.equal(current, sent, 'clearing search must not jump back to the earlier Inbox search');
});
