"use strict";

const INPUT_METHOD_SURFACES = new Set(["terminal", "ai-chat"]);

function loadNativeInputMethodAdapter() {
  try {
    const adapter = require("../../packages/input-method-native");
    if (
      adapter?.supported === true
      && typeof adapter.getInputMethodStateForWindow === "function"
      && typeof adapter.requestInputMethodStateForWindow === "function"
    ) {
      return adapter;
    }
  } catch (error) {
    console.warn("[InputMethod] Native adapter unavailable:", error?.message || error);
  }
  return null;
}

function isInputMethodSurface(value) {
  return value === null || INPUT_METHOD_SURFACES.has(value);
}

function normalizeInputMethodState(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.layout !== "bigint" || value.layout === 0n) return null;

  const state = { layout: value.layout };
  if (typeof value.imeOpen === "boolean") state.imeOpen = value.imeOpen;
  if (Number.isSafeInteger(value.conversionMode) && value.conversionMode >= 0) {
    state.conversionMode = value.conversionMode;
  }
  if (Number.isSafeInteger(value.sentenceMode) && value.sentenceMode >= 0) {
    state.sentenceMode = value.sentenceMode;
  }
  return state;
}

function inputMethodStatesEqual(left, right) {
  if (!left || !right || left.layout !== right.layout) return false;
  for (const key of ["imeOpen", "conversionMode", "sentenceMode"]) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function createInputMethodMemoryController(nativeAdapter) {
  const statesByWindow = new WeakMap();

  const getState = (window) => {
    let state = statesByWindow.get(window);
    if (!state) {
      state = { activeSurface: null, inputMethods: new Map() };
      statesByWindow.set(window, state);
    }
    return state;
  };

  const transition = (window, nextSurface) => {
    if (!nativeAdapter || !isInputMethodSurface(nextSurface)) {
      return { supported: Boolean(nativeAdapter), applied: false };
    }

    const state = getState(window);
    if (state.activeSurface === nextSurface) {
      return { supported: true, applied: false };
    }

    const windowHandle = window.getNativeWindowHandle();
    const currentInputMethod = normalizeInputMethodState(
      nativeAdapter.getInputMethodStateForWindow(windowHandle),
    );
    if (state.activeSurface && currentInputMethod) {
      state.inputMethods.set(state.activeSurface, currentInputMethod);
    }

    let applied = false;
    const rememberedInputMethod = nextSurface
      ? state.inputMethods.get(nextSurface)
      : undefined;
    if (rememberedInputMethod &&
        !inputMethodStatesEqual(rememberedInputMethod, currentInputMethod)) {
      applied = nativeAdapter.requestInputMethodStateForWindow(
        windowHandle,
        rememberedInputMethod,
      ) === true;
    }

    state.activeSurface = nextSurface;
    return { supported: true, applied };
  };

  const reset = (window) => {
    statesByWindow.delete(window);
    return { supported: Boolean(nativeAdapter) };
  };

  return {
    supported: Boolean(nativeAdapter),
    transition,
    reset,
  };
}

function createInputMethodBridge({ BrowserWindow, nativeAdapter = loadNativeInputMethodAdapter() }) {
  const controller = createInputMethodMemoryController(nativeAdapter);

  const resolveWindow = (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed?.()) return null;
    return window;
  };

  return {
    register(ipcMain) {
      ipcMain.handle("netcatty:input-method:support", () => ({
        supported: controller.supported,
        platform: process.platform,
      }));

      ipcMain.handle("netcatty:input-method:surface", (event, surface) => {
        if (!isInputMethodSurface(surface)) {
          return { supported: controller.supported, applied: false, error: "invalid-surface" };
        }
        const window = resolveWindow(event);
        if (!window) {
          return { supported: controller.supported, applied: false, error: "window-unavailable" };
        }
        try {
          return controller.transition(window, surface);
        } catch (error) {
          console.warn("[InputMethod] Surface transition failed:", error?.message || error);
          return { supported: controller.supported, applied: false, error: "transition-failed" };
        }
      });

      ipcMain.handle("netcatty:input-method:reset", (event) => {
        const window = resolveWindow(event);
        if (!window) return { supported: controller.supported };
        return controller.reset(window);
      });
    },
  };
}

module.exports = {
  createInputMethodBridge,
  createInputMethodMemoryController,
  inputMethodStatesEqual,
  isInputMethodSurface,
  loadNativeInputMethodAdapter,
  normalizeInputMethodState,
};
