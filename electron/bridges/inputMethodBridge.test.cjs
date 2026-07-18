"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  createInputMethodBridge,
  createInputMethodMemoryController,
  inputMethodStatesEqual,
  isInputMethodSurface,
  loadNativeInputMethodAdapter,
  normalizeInputMethodState,
  resolveNativeInputMethodCandidates,
} = require("./inputMethodBridge.cjs");

const createWindow = (id) => ({
  id,
  getNativeWindowHandle: () => Buffer.from([id]),
});

const nativeAdapter = {
  supported: true,
  getInputMethodStateForWindow: () => null,
  requestInputMethodStateForWindow: () => false,
};

test("native adapter candidates prefer the packaged workspace artifact", () => {
  const resourcesPath = path.resolve("release/win-unpacked/resources");
  const bridgeDir = path.resolve("electron/bridges");
  const candidates = resolveNativeInputMethodCandidates({ resourcesPath, bridgeDir });

  assert.deepEqual(candidates.map(({ source }) => source), [
    "packaged-workspace",
    "packaged-node-modules",
    "development-workspace",
  ]);
  assert.equal(candidates[0].modulePath, path.join(
    resourcesPath,
    "app.asar.unpacked",
    "packages",
    "input-method-native",
    "build",
    "Release",
    "input_method_native.node",
  ));
});

test("native adapter loader falls back in deterministic candidate order", () => {
  const attempted = [];
  const result = loadNativeInputMethodAdapter({
    platform: "win32",
    resourcesPath: path.resolve("portable/resources"),
    bridgeDir: path.resolve("electron/bridges"),
    requireFn: (modulePath) => {
      attempted.push(modulePath);
      if (attempted.length === 1) throw new Error("missing primary artifact");
      return nativeAdapter;
    },
  });

  assert.equal(result.supported, true);
  assert.equal(result.adapter, nativeAdapter);
  assert.equal(result.source, "packaged-node-modules");
  assert.deepEqual(result.attemptedCandidates, [
    "packaged-workspace",
    "packaged-node-modules",
  ]);
  assert.equal(attempted.length, 2);
});

test("native adapter loader returns structured failure diagnostics", () => {
  const unavailable = loadNativeInputMethodAdapter({
    platform: "win32",
    resourcesPath: path.resolve("portable/resources"),
    bridgeDir: path.resolve("electron/bridges"),
    requireFn: () => { throw new Error("not found"); },
  });
  assert.equal(unavailable.supported, false);
  assert.equal(unavailable.adapter, null);
  assert.equal(unavailable.errorCode, "native-module-unavailable");
  assert.deepEqual(unavailable.attemptedCandidates, [
    "packaged-workspace",
    "packaged-node-modules",
    "development-workspace",
  ]);

  const invalid = loadNativeInputMethodAdapter({
    platform: "win32",
    resourcesPath: undefined,
    bridgeDir: path.resolve("electron/bridges"),
    requireFn: () => ({ supported: true }),
  });
  assert.equal(invalid.errorCode, "native-adapter-invalid");

  const unsupportedPlatform = loadNativeInputMethodAdapter({
    platform: "linux",
    requireFn: () => { throw new Error("must not load"); },
  });
  assert.deepEqual(unsupportedPlatform.attemptedCandidates, []);
  assert.equal(unsupportedPlatform.errorCode, "unsupported-platform");
});

test("support IPC exposes concise diagnostics without native paths", async () => {
  const handlers = new Map();
  const bridge = createInputMethodBridge({
    BrowserWindow: {},
    nativeLoadResult: {
      supported: false,
      adapter: null,
      errorCode: "unsupported-platform",
      error: "Input method memory is only available on Windows.",
      attemptedCandidates: ["development-workspace"],
    },
  });
  bridge.register({
    handle: (channel, handler) => handlers.set(channel, handler),
  });

  const support = await handlers.get("netcatty:input-method:support")();
  assert.deepEqual(support, {
    supported: false,
    platform: process.platform,
    errorCode: "unsupported-platform",
    error: "Input method memory is only available on Windows.",
  });
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
