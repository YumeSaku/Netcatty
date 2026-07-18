"use strict";

const path = require("node:path");

const INPUT_METHOD_SURFACES = new Set(["terminal", "ai-chat"]);

function resolveNativeInputMethodCandidates({
  resourcesPath = process.resourcesPath,
  bridgeDir = __dirname,
} = {}) {
  const candidates = [];
  if (resourcesPath) {
    candidates.push(
      {
        source: "packaged-workspace",
        modulePath: path.join(
          resourcesPath,
          "app.asar.unpacked",
          "packages",
          "input-method-native",
          "build",
          "Release",
          "input_method_native.node",
        ),
      },
      {
        source: "packaged-node-modules",
        modulePath: path.join(
          resourcesPath,
          "app.asar.unpacked",
          "node_modules",
          "@netcatty",
          "input-method-native",
          "build",
          "Release",
          "input_method_native.node",
        ),
      },
    );
  }
  candidates.push({
    source: "development-workspace",
    modulePath: path.resolve(
      bridgeDir,
      "../../packages/input-method-native/build/Release/input_method_native.node",
    ),
  });

  const seen = new Set();
  return candidates.filter(({ modulePath }) => {
    const key = path.normalize(modulePath).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isNativeInputMethodAdapter(value) {
  return value?.supported === true
    && typeof value.getInputMethodStateForWindow === "function"
    && typeof value.requestInputMethodStateForWindow === "function";
}

function loadNativeInputMethodAdapter({
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  bridgeDir = __dirname,
  requireFn = require,
} = {}) {
  if (platform !== "win32") {
    return {
      supported: false,
      adapter: null,
      errorCode: "unsupported-platform",
      error: "Input method memory is only available on Windows.",
      attemptedCandidates: [],
    };
  }

  const candidates = resolveNativeInputMethodCandidates({ resourcesPath, bridgeDir });
  let loadedInvalidAdapter = false;
  const loadErrors = [];
  for (const candidate of candidates) {
    try {
      const adapter = requireFn(candidate.modulePath);
      if (isNativeInputMethodAdapter(adapter)) {
        return {
          supported: true,
          adapter,
          source: candidate.source,
          attemptedCandidates: candidates
            .slice(0, candidates.indexOf(candidate) + 1)
            .map(({ source }) => source),
        };
      }
      loadedInvalidAdapter = true;
      loadErrors.push({
        source: candidate.source,
        errorCode: "native-adapter-invalid",
        error: "Module loaded but did not expose the required adapter interface.",
      });
    } catch (error) {
      loadErrors.push({
        source: candidate.source,
        errorCode: typeof error?.code === "string" ? error.code : "native-load-error",
        error: error?.message || String(error),
      });
      // Try the next deterministic package location.
    }
  }

  return {
    supported: false,
    adapter: null,
    errorCode: loadedInvalidAdapter ? "native-adapter-invalid" : "native-module-unavailable",
    error: loadedInvalidAdapter
      ? "The native input method module has an invalid interface."
      : "The native input method module could not be loaded.",
    attemptedCandidates: candidates.map(({ source }) => source),
    loadErrors,
  };
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

function createInputMethodBridge({ BrowserWindow, nativeAdapter, nativeLoadResult } = {}) {
  const injectedAdapterIsValid = isNativeInputMethodAdapter(nativeAdapter);
  const loadResult = nativeLoadResult
    ?? (nativeAdapter === undefined
      ? loadNativeInputMethodAdapter()
      : {
          supported: injectedAdapterIsValid,
          adapter: injectedAdapterIsValid ? nativeAdapter : null,
          ...(!injectedAdapterIsValid
            ? nativeAdapter === null
              ? {
                  errorCode: "native-module-unavailable",
                  error: "The native input method module could not be loaded.",
                }
              : {
                  errorCode: "native-adapter-invalid",
                  error: "The native input method module has an invalid interface.",
                }
            : {}),
        });
  const resolvedAdapter = loadResult.supported === true ? loadResult.adapter : null;
  if (!loadResult.supported && loadResult.errorCode !== "unsupported-platform") {
    console.warn(`[InputMethod] Native adapter unavailable (${loadResult.errorCode}).`);
  }
  const controller = createInputMethodMemoryController(resolvedAdapter);

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
        ...(loadResult.errorCode ? { errorCode: loadResult.errorCode } : {}),
        ...(loadResult.error ? { error: loadResult.error } : {}),
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
  isNativeInputMethodAdapter,
  isInputMethodSurface,
  loadNativeInputMethodAdapter,
  normalizeInputMethodState,
  resolveNativeInputMethodCandidates,
};
