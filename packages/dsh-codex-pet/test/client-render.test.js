import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const source = fs.readFileSync(path.join(pkgRoot, 'src', 'client.js'), 'utf8');

// Resolve the paired development dependencies from this package so the test
// behaves the same on every checkout and in CI.
const req = createRequire(import.meta.url);
const react = req('react');
const renderToString = req('react-dom/server').renderToString;

let factory = null;
const fakeWindow = { __ModuleLoader__: { load: (def) => { factory = def.factory; } } };
const requireReactOnly = (name) => {
  if (name === 'react') return react;
  throw new Error('client.js required unexpected module: ' + name);
};
new Function('window', 'require', source)(fakeWindow, requireReactOnly);
assert.ok(factory, 'module loader captured the factory');

const mod = factory(requireReactOnly);
assert.ok(mod.__internals, 'internals hook exposed');

test('SoundControls renders the unified scenario panel', () => {
  const html = renderToString(react.createElement(mod.__internals.SoundControls, {
    sound: {
      enabled: true,
      volume: 60,
      tracks: {
        done: { enabled: true, volume: 100 },
        error: { enabled: false, volume: 70 },
        interrupt: { enabled: true, volume: 100 },
      },
    },
    hasCustomSounds: { done: false, error: true, interrupt: false },
    reload: () => {},
  }));
  for (const needle of ['任务完成时', '遇到错误时', '被中断时', '启用场景语音', '内置', '试听']) {
    assert.ok(html.includes(needle), 'rendered html should contain ' + needle);
  }
  assert.ok(!html.includes('音色风格'), 'the persona picker is gone - takes rotate instead');
  const afterErrorRow = html.split('遇到错误时')[1] || '';
  assert.ok(afterErrorRow.includes('内置'), 'error row with an override should offer the built-in revert');
});

test('latestTurnInterrupted flags the newest aborted turn only', () => {
  const { latestTurnInterrupted, completedTurnsOf } = mod.__internals;
  const snap = {
    turnEnds: new Map([[1, 12], [2, 30]]),
    nodes: [
      { kind: 'assistant', turn: 1, blocks: [] },
      { kind: 'assistant', turn: 2, interrupted: true, blocks: [] },
    ],
  };
  assert.deepEqual(completedTurnsOf(snap), [1, 2]);
  assert.equal(latestTurnInterrupted(snap), true, 'turn 2 is interrupted');
  assert.equal(latestTurnInterrupted({ turnEnds: snap.turnEnds, nodes: [{ kind: 'assistant', turn: 2, blocks: [] }] }), false, 'clean turn is not interrupted');
  assert.equal(latestTurnInterrupted(null), false);
  assert.equal(latestTurnInterrupted({ turnEnds: new Map(), nodes: [] }), false);
});

test('latestTurnErrored flags the newest failed turn only', () => {
  const { latestTurnErrored } = mod.__internals;
  const snap = {
    turnEnds: new Map([[1, 12], [2, 30]]),
    nodes: [
      { kind: 'turn-error', turn: 1, message: 'old failure' },
      { kind: 'assistant', turn: 2, blocks: [] },
    ],
  };
  assert.equal(latestTurnErrored(snap), false, 'turn 2 finished cleanly');
  const errored = {
    turnEnds: new Map([[1, 12], [2, 30]]),
    nodes: [{ kind: 'turn-error', turn: 2, message: 'boom' }],
  };
  assert.equal(latestTurnErrored(errored), true, 'turn 2 died on an error');
});

test('deferred done check uses the latest failure state', () => {
  const { shouldPlayDone } = mod.__internals;
  const state = {
    activeSessionId: 'session-a',
    expectedSessionId: 'session-a',
    activity: 'idle',
    muteUntil: 0,
    now: 100,
  };
  const clean = {
    turnEnds: new Map([[1, 12]]),
    nodes: [{ kind: 'assistant', turn: 1, blocks: [] }],
  };
  const failed = {
    turnEnds: new Map([[1, 12]]),
    nodes: [{ kind: 'turn-error', turn: 1, message: 'boom' }],
  };

  assert.equal(shouldPlayDone(clean, state), true);
  assert.equal(shouldPlayDone(failed, state), false, 'a failure arriving during the delay suppresses done');
  assert.equal(shouldPlayDone(clean, { ...state, activeSessionId: 'session-b' }), false, 'a session switch cancels done');
  assert.equal(shouldPlayDone(clean, { ...state, muteUntil: 101 }), false, 'an error/interrupt mute cancels done');
});

test('summary cadence counts completed model requests within one turn', () => {
  const { completedModelRequestsOf, buildSummaryPayload } = mod.__internals;
  const requests = [
    { purpose: 'assistant', startSeq: 10, resultSeq: 20, turn: 1, step: 1, status: 'complete' },
    { purpose: 'assistant', startSeq: 30, resultSeq: 40, turn: 1, step: 2, status: 'complete' },
    { purpose: 'assistant', startSeq: 50, turn: 1, step: 3, status: 'error', error: 'provider failed' },
    { purpose: 'assistant', startSeq: 60, turn: 1, step: 4, status: 'running' },
    { purpose: 'compaction', startSeq: 70, turn: 1, step: 0, status: 'complete' },
  ];
  const nodes = [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: 'fix login' }] },
    { kind: 'assistant', seq: 20, turn: 1, step: 1, blocks: [{ kind: 'tool-call', callId: 'call-1', name: 'read', argsRaw: 'auth.js' }] },
    { kind: 'tool-result', seq: 25, callId: 'call-1', isError: true },
    { kind: 'assistant', seq: 40, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'fixed it' }] },
  ];
  const snap = { views: { get: (name) => name === 'trajectory' ? { requests } : undefined }, nodes };

  const completed = completedModelRequestsOf(snap);
  assert.deepEqual(completed.map((request) => request.startSeq), [10, 30, 50]);
  const payload = buildSummaryPayload(nodes, completed.slice(0, 2), 'session-a');
  assert.equal(payload.fromRequestSeq, 10);
  assert.equal(payload.toRequestSeq, 30);
  assert.deepEqual(payload.requests.map((request) => [request.turn, request.step]), [[1, 1], [1, 2]]);
  assert.equal(payload.requests[0].user, 'fix login');
  assert.equal(payload.requests[0].actions[0].failed, true);
  assert.equal(payload.requests[1].assistant, 'fixed it');
  assert.equal(payload.requests[1].user, '', 'the same turn instruction is not repeated for later requests');
});

test('automatic summary baseline excludes requests that existed before session selection', () => {
  const { baselineAutoTracker } = mod.__internals;
  assert.deepEqual(baselineAutoTracker('historical', [{ startSeq: 10 }, { startSeq: 30 }]), {
    sessionId: 'historical', lastSeenRequestSeq: 30, windowStartRequestSeq: 31, retryCount: 0,
  });
  assert.deepEqual(baselineAutoTracker('empty', []), {
    sessionId: 'empty', lastSeenRequestSeq: -1, windowStartRequestSeq: null, retryCount: 0,
  });
});

test('manual summary filters every request covered by persisted journal ranges', () => {
  const { uncoveredModelRequestsOf } = mod.__internals;
  const requests = [{ startSeq: 10 }, { startSeq: 20 }, { startSeq: 30 }, { startSeq: 40 }, { startSeq: 50 }];
  const records = [{ fromRequestSeq: 10, toRequestSeq: 20 }, { fromRequestSeq: 40, toRequestSeq: 45 }];
  assert.deepEqual(uncoveredModelRequestsOf(requests, records).map((request) => request.startSeq), [30, 50]);
  assert.deepEqual(uncoveredModelRequestsOf([{ startSeq: 10 }], [{ fromRequestSeq: 1, toRequestSeq: 10 }]), [], 'zero uncovered requests need no analysis');
});

test('manual summary batches are capped by configured interval and server maximum', () => {
  const { summaryBatches } = mod.__internals;
  const requests = Array.from({ length: 103 }, (_, index) => ({ startSeq: index }));
  assert.deepEqual(summaryBatches(requests, 3).map((batch) => batch.length), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1]);
  assert.deepEqual(summaryBatches(requests, 99).map((batch) => batch.length), [50, 50, 3]);
});

test('manual summary reads the summary config object and top-level response text', () => {
  const { manualSummaryEnabled, summaryTextFromResponse } = mod.__internals;
  assert.equal(manualSummaryEnabled({ enabled: true, provider: 'p', model: 'm' }), true);
  assert.equal(manualSummaryEnabled({ enabled: true, provider: 'p', model: '' }), false);
  assert.equal(manualSummaryEnabled({ summary: { enabled: true } }), false);
  assert.equal(summaryTextFromResponse({ summary: 'completed work' }), 'completed work');
  assert.equal(summaryTextFromResponse({ record: { summary: 'wrong response shape' } }), '');
});

test('SummaryControls requires a provider and model before enabling summaries', () => {
  const html = renderToString(react.createElement(mod.__internals.SummaryControls, {
    summary: { enabled: true, provider: 'p', model: '' },
    reload: () => {},
  }));
  assert.ok(html.includes('disabled'), 'incomplete routes disable the enable checkbox');
  assert.ok(html.includes('Select provider and model first'), 'the route requirement is shown bilingually');
  assert.ok(!html.includes('自动（'), 'automatic route selection is not offered');
});

test('manual backfill advances the automatic summary cursor after each persisted batch', () => {
  const { advanceAutoTrackerAfterManual } = mod.__internals;
  const tracker = { sessionId: 'session-a', lastSeenRequestSeq: 70, windowStartRequestSeq: 11, retryCount: 2 };
  advanceAutoTrackerAfterManual(tracker, 'session-a', [{ startSeq: 10 }, { startSeq: 30 }]);
  assert.deepEqual(tracker, { sessionId: 'session-a', lastSeenRequestSeq: 70, windowStartRequestSeq: 31, retryCount: 2 });

  advanceAutoTrackerAfterManual(tracker, 'session-a', [{ startSeq: 40 }, { startSeq: 50 }]);
  assert.deepEqual(tracker, { sessionId: 'session-a', lastSeenRequestSeq: 70, windowStartRequestSeq: 51, retryCount: 2 });

  // A later failed batch is not passed to the helper, so completed coverage remains advanced.
  assert.equal(tracker.windowStartRequestSeq, 51, 'a later failed batch leaves the cursor after the last persisted batch');

  advanceAutoTrackerAfterManual(tracker, 'session-a', [{ startSeq: 20 }]);
  assert.equal(tracker.windowStartRequestSeq, 51, 'an older manual range never moves the cursor backward');

  const newerManual = { sessionId: 'session-a', lastSeenRequestSeq: 10, windowStartRequestSeq: 11, retryCount: 0 };
  advanceAutoTrackerAfterManual(newerManual, 'session-a', [{ startSeq: 30 }]);
  assert.deepEqual(newerManual, { sessionId: 'session-a', lastSeenRequestSeq: 30, windowStartRequestSeq: 31, retryCount: 0 });

  advanceAutoTrackerAfterManual(tracker, 'session-b', [{ startSeq: 100 }]);
  assert.deepEqual(tracker, { sessionId: 'session-a', lastSeenRequestSeq: 70, windowStartRequestSeq: 51, retryCount: 2 }, 'a session switch does not alter the current cursor');
});

test('SettingsSection renders its loading state without a host', () => {
  const html = renderToString(react.createElement(mod.__internals.SettingsSection));
  assert.ok(html.includes('加载中'), 'initial render should show the loading state');
});
