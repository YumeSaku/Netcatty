import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INPUT_METHOD_SUPPORT_CHECKING,
  inputMethodMemorySupportFailure,
  resolveInputMethodMemorySupport,
} from './useInputMethodMemorySupport';

test('input method support begins in a distinct checking state', () => {
  assert.deepEqual(INPUT_METHOD_SUPPORT_CHECKING, {
    status: 'checking',
    supported: false,
  });
});

test('input method support preserves structured success and failure diagnostics', () => {
  assert.deepEqual(resolveInputMethodMemorySupport({ supported: true, platform: 'win32' }), {
    status: 'supported',
    supported: true,
    platform: 'win32',
  });
  assert.deepEqual(resolveInputMethodMemorySupport({
    supported: false,
    platform: 'win32',
    errorCode: 'native-module-unavailable',
    error: 'The native input method module could not be loaded.',
  }), {
    status: 'unsupported',
    supported: false,
    platform: 'win32',
    errorCode: 'native-module-unavailable',
    error: 'The native input method module could not be loaded.',
  });
});

test('input method support represents transient check failures without losing retryability', () => {
  assert.deepEqual(inputMethodMemorySupportFailure(), {
    status: 'unsupported',
    supported: false,
    errorCode: 'support-check-failed',
  });
});
