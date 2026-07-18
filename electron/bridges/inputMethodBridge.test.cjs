"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createInputMethodMemoryController,
  isInputMethodSurface,
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

test("controller learns and restores layouts per surface", () => {
  let currentLayout = 0x409n;
  const applied = [];
  const controller = createInputMethodMemoryController({
    getKeyboardLayoutForWindow: () => currentLayout,
    requestKeyboardLayoutForWindow: (_handle, layout) => {
      applied.push(layout);
      currentLayout = layout;
      return true;
    },
  });
  const window = createWindow(1);

  assert.deepEqual(controller.transition(window, "terminal"), { supported: true, applied: false });
  assert.deepEqual(controller.transition(window, "ai-chat"), { supported: true, applied: false });
  currentLayout = 0x804n;
  assert.deepEqual(controller.transition(window, "terminal"), { supported: true, applied: true });
  assert.deepEqual(applied, [0x409n]);
  assert.deepEqual(controller.transition(window, "ai-chat"), { supported: true, applied: true });
  assert.deepEqual(applied, [0x409n, 0x804n]);
});

test("controller isolates remembered layouts by BrowserWindow", () => {
  const layouts = new Map([[1, 0x409n], [2, 0x411n]]);
  const applied = [];
  const controller = createInputMethodMemoryController({
    getKeyboardLayoutForWindow: (handle) => layouts.get(handle[0]),
    requestKeyboardLayoutForWindow: (handle, layout) => {
      applied.push([handle[0], layout]);
      layouts.set(handle[0], layout);
      return true;
    },
  });
  const first = createWindow(1);
  const second = createWindow(2);

  controller.transition(first, "terminal");
  controller.transition(first, "ai-chat");
  layouts.set(1, 0x804n);

  controller.transition(second, "terminal");
  controller.transition(second, "ai-chat");
  layouts.set(2, 0x412n);

  controller.transition(first, "terminal");
  controller.transition(second, "terminal");
  assert.deepEqual(applied, [[1, 0x409n], [2, 0x411n]]);
});

test("controller reset forgets learned layouts", () => {
  let currentLayout = 0x409n;
  let applyCount = 0;
  const controller = createInputMethodMemoryController({
    getKeyboardLayoutForWindow: () => currentLayout,
    requestKeyboardLayoutForWindow: () => {
      applyCount += 1;
      return true;
    },
  });
  const window = createWindow(1);

  controller.transition(window, "terminal");
  controller.transition(window, "ai-chat");
  currentLayout = 0x804n;
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
