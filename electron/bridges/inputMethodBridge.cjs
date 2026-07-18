"use strict";

const INPUT_METHOD_SURFACES = new Set(["terminal", "ai-chat"]);

function loadNativeInputMethodAdapter() {
  try {
    const adapter = require("@netcatty/input-method-native");
    if (
      adapter?.supported === true
      && typeof adapter.getKeyboardLayoutForWindow === "function"
      && typeof adapter.requestKeyboardLayoutForWindow === "function"
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

function createInputMethodMemoryController(nativeAdapter) {
  const statesByWindow = new WeakMap();

  const getState = (window) => {
    let state = statesByWindow.get(window);
    if (!state) {
      state = { activeSurface: null, layouts: new Map() };
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
    const currentLayout = nativeAdapter.getKeyboardLayoutForWindow(windowHandle);
    if (state.activeSurface && typeof currentLayout === "bigint" && currentLayout !== 0n) {
      state.layouts.set(state.activeSurface, currentLayout);
    }

    let applied = false;
    const rememberedLayout = nextSurface ? state.layouts.get(nextSurface) : undefined;
    if (
      typeof rememberedLayout === "bigint"
      && rememberedLayout !== 0n
      && rememberedLayout !== currentLayout
    ) {
      applied = nativeAdapter.requestKeyboardLayoutForWindow(windowHandle, rememberedLayout) === true;
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
  isInputMethodSurface,
  loadNativeInputMethodAdapter,
};
