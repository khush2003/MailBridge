/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';
import { Actions } from 'mailspring-exports';

import ThreadSearchBar, { ThreadSearchBar as SearchBar } from '../lib/thread-search-bar';
import * as SearchBarUtil from '../lib/search-bar-util';

describe('ThreadSearchBar', function () {
  beforeEach(function () {
    spyOn(AppEnv, 'isMainWindow').andReturn(true);
    this.searchBar = ReactTestUtils.renderIntoDocument(<ThreadSearchBar />);
    this.input = (ReactDOM.findDOMNode(this.searchBar) as HTMLElement).querySelector(
      '[contenteditable]'
    );
  });

  it('preserves capitalization on searches', function () {
    spyOn(Actions, 'searchQueryChanged');
    const test = 'HeLlO wOrLd';
    ReactTestUtils.Simulate.input(this.input, { target: { innerText: test } as any });
    expect(Actions.searchQueryChanged).toHaveBeenCalledWith(test);
  });
});

describe('ThreadSearchBar asynchronous suggestions', () => {
  it('ignores a slow result after the user has entered a newer query', async () => {
    let resolveContacts;
    spyOn(SearchBarUtil, 'getContactSuggestions').andCallFake(
      () =>
        new Promise((resolve) => {
          resolveContacts = resolve;
        })
    );
    spyOn(SearchBarUtil, 'getThreadSuggestions').andReturn(Promise.resolve([]));
    const bar = new SearchBar({
      query: '',
      isSearching: false,
      perspective: { accountIds: [], isInbox: () => true } as any,
    });
    bar._fieldEl = { insertionIndex: () => 3 } as any;
    const update = spyOn(bar, '_setSuggestionState');
    const slow = bar._generateSuggestionsForQuery('old');
    await bar._generateSuggestionsForQuery('is:');
    resolveContacts(['old@example.test']);
    await slow;
    expect(update.calls.length).toBe(1);
    expect(update.mostRecentCall.args[0].map((s) => s.term)).toEqual(['"unread"', '"starred"']);
  });
});
