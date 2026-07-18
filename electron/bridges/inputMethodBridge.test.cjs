"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createInputMethodMemoryController,
  inputMethodStatesEqual,
  isInputMethodSurface,
  normalizeInputMethodState,
} = require("./inputMethodBridge.cjs");

const createWindow = (id) => ({
  id,
  getNativeWindowHandle: () => Buffer.from([id]),
});

test("input method surfaces accept only the renderer contract", () => {
  assert.equal(isInputMethodSurface("terminal"), true);
  assert.equal(isInputMethodSurface("ai-chat"), true);
  assert.equal(isInputMethodSurface(null), true);
  assert.equal(isInputMethodSurface("settings"), false);
  assert.equal(isInputMethodSurface(undefined), false);
});

test("normalizes and compares input method state", () => {
  const chinese = { layout: 0x804n, imeOpen: true, conversionMode: 1025, sentenceMode: 0 };
  assert.deepEqual(normalizeInputMethodState({ ...chinese, ignored: true }), chinese);
  assert.equal(normalizeInputMethodState({ layout: 0n }), null);
  assert.equal(normalizeInputMethodState({ layout: 0x804 }), null);
  assert.equal(inputMethodStatesEqual(chinese, { ...chinese }), true);
  assert.equal(inputMethodStatesEqual(chinese, { ...chinese, imeOpen: false }), false);
});

test("controller learns and restores full input method state per surface", () => {
  const english = { layout: 0x804n, imeOpen: false, conversionMode: 0, sentenceMode: 0 };
  const chinese = { layout: 0x804n, imeOpen: true, conversionMode: 1025, sentenceMode: 0 };
  let current = english;
  const applied = [];
  const controller = createInputMethodMemoryController({
    getInputMethodStateForWindow: () => current,
    requestInputMethodStateForWindow: (_handle, inputMethod) => {
      applied.push(inputMethod);
      current = inputMethod;
      return true;
    },
  });
  const window = createWindow(1);

  assert.deepEqual(controller.transition(window, "terminal"), { supported: true, applied: false });
  assert.deepEqual(controller.transition(window, "ai-chat"), { supported: true, applied: false });
  current = chinese;
  assert.deepEqual(controller.transition(window, "terminal"), { supported: true, applied: true });
  assert.deepEqual(controller.transition(window, "ai-chat"), { supported: true, applied: true });
  assert.deepEqual(applied, [english, chinese]);
});

test("controller isolates remembered input methods by BrowserWindow", () => {
  const current = new Map([
    [1, { layout: 0x804n, imeOpen: false }],
    [2, { layout: 0x411n, imeOpen: false }],
  ]);
  const applied = [];
  const controller = createInputMethodMemoryController({
    getInputMethodStateForWindow: (handle) => current.get(handle[0]),
    requestInputMethodStateForWindow: (handle, inputMethod) => {
      applied.push([handle[0], inputMethod]);
      current.set(handle[0], inputMethod);
      return true;
    },
  });
  const first = createWindow(1);
  const second = createWindow(2);

  controller.transition(first, "terminal");
  controller.transition(first, "ai-chat");
  current.set(1, { layout: 0x804n, imeOpen: true });
  controller.transition(second, "terminal");
  controller.transition(second, "ai-chat");
  current.set(2, { layout: 0x411n, imeOpen: true });
  controller.transition(first, "terminal");
  controller.transition(second, "terminal");
  assert.deepEqual(applied, [
    [1, { layout: 0x804n, imeOpen: false }],
    [2, { layout: 0x411n, imeOpen: false }],
  ]);
});

test("controller reset forgets learned input method states", () => {
  let current = { layout: 0x804n, imeOpen: false };
  let applyCount = 0;
  const controller = createInputMethodMemoryController({
    getInputMethodStateForWindow: () => current,
    requestInputMethodStateForWindow: () => { applyCount += 1; return true; },
  });
  const window = createWindow(1);
  controller.transition(window, "terminal");
  controller.transition(window, "ai-chat");
  current = { layout: 0x804n, imeOpen: true };
  controller.reset(window);
  controller.transition(window, "terminal");
  assert.equal(applyCount, 0);
});

test("unsupported controller is a no-op", () => {
  const controller = createInputMethodMemoryController(null);
  assert.deepEqual(controller.transition(createWindow(1), "terminal"), {
    supported: false,
    applied: false,
  });
});
