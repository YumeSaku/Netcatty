import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInputMethodSurfaceTracker,
  getInputMethodSurface,
  type InputMethodSurface,
} from './useInputMethodSurfaceMemory';

const createTarget = (surface?: string) => ({
  closest: () => surface
    ? { getAttribute: () => surface }
    : null,
}) as unknown as EventTarget;

test('getInputMethodSurface accepts only known surface markers', () => {
  assert.equal(getInputMethodSurface(createTarget('terminal')), 'terminal');
  assert.equal(getInputMethodSurface(createTarget('ai-chat')), 'ai-chat');
  assert.equal(getInputMethodSurface(createTarget('settings')), null);
  assert.equal(getInputMethodSurface(null), null);
});

test('surface tracker coalesces focus events and emits final surface', () => {
  const terminal = createTarget('terminal');
  const chat = createTarget('ai-chat');
  let activeElement: EventTarget | null = terminal;
  let scheduled: (() => void) | null = null;
  const applied: Array<InputMethodSurface | null> = [];
  const tracker = createInputMethodSurfaceTracker({
    getActiveElement: () => activeElement,
    applySurface: (surface) => applied.push(surface),
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    cancel: () => {},
  });

  tracker.focusChanged();
  activeElement = chat;
  tracker.focusChanged();
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(applied, ['ai-chat']);

  scheduled = null;
  activeElement = createTarget();
  tracker.focusChanged();
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(applied, ['ai-chat', null]);
});

test('surface tracker waits for composition to end', () => {
  const chat = createTarget('ai-chat');
  let activeElement: EventTarget | null = chat;
  let scheduled: (() => void) | null = null;
  const applied: Array<InputMethodSurface | null> = [];
  const tracker = createInputMethodSurfaceTracker({
    getActiveElement: () => activeElement,
    applySurface: (surface) => applied.push(surface),
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    cancel: () => {},
  });

  tracker.compositionStarted(chat);
  tracker.focusChanged();
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(applied, []);

  scheduled = null;
  tracker.compositionEnded(chat);
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(applied, ['ai-chat']);

  activeElement = createTarget('terminal');
  scheduled = null;
  tracker.compositionStarted(chat);
  tracker.focusChanged();
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(applied, ['ai-chat']);

  scheduled = null;
  tracker.compositionEnded(chat);
  assert.ok(scheduled);
  (scheduled as () => void)();
  assert.deepEqual(applied, ['ai-chat', 'terminal']);
});
