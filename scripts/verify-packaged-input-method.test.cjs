"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  escapeWorkflowCommand,
  verifyPackagedInputMethod,
} = require("./verify-packaged-input-method.cjs");

test("packaged input method verifier passes resources path to the packaged bridge", () => {
  let receivedOptions;
  const adapter = {
    supported: true,
    getInputMethodStateForWindow: () => null,
    requestInputMethodStateForWindow: () => false,
  };
  const result = verifyPackagedInputMethod({
    bridgePath: "app.asar/electron/bridges/inputMethodBridge.cjs",
    resourcesPath: "win-unpacked/resources",
    requireFn: () => ({
      loadNativeInputMethodAdapter: (options) => {
        receivedOptions = options;
        return { supported: true, adapter, source: "packaged-workspace" };
      },
    }),
  });

  assert.deepEqual(receivedOptions, { resourcesPath: "win-unpacked/resources" });
  assert.deepEqual(result, { supported: true, source: "packaged-workspace" });
});

test("packaged input method verifier preserves structured load diagnostics", () => {
  assert.throws(
    () => verifyPackagedInputMethod({
      bridgePath: "app.asar/electron/bridges/inputMethodBridge.cjs",
      resourcesPath: "win-unpacked/resources",
      requireFn: () => ({
        loadNativeInputMethodAdapter: () => ({
          supported: false,
          errorCode: "native-module-unavailable",
          attemptedCandidates: ["packaged-workspace"],
          loadErrors: [{ source: "packaged-workspace", errorCode: "MODULE_NOT_FOUND" }],
        }),
      }),
    }),
    (error) => {
      assert.equal(error.details.errorCode, "native-module-unavailable");
      assert.deepEqual(error.details.loadErrors, [
        { source: "packaged-workspace", errorCode: "MODULE_NOT_FOUND" },
      ]);
      return true;
    },
  );
});

test("workflow command escaping keeps diagnostics on one annotation line", () => {
  assert.equal(escapeWorkflowCommand("bad%path\r\nnext"), "bad%25path%0D%0Anext");
});
