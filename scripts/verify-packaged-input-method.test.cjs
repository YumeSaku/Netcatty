"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  escapeWorkflowCommand,
  isDirectExecution,
  run,
  runIfDirectExecution,
  verifyPackagedInputMethod,
  writeReportAtomic,
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
      assert.equal(error.phase, "native-adapter-load");
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

test("Electron-style direct execution uses the explicit verifier environment", () => {
  const argv = ["electron.exe", "C:\\repo\\scripts\\verify-packaged-input-method.cjs"];
  let receivedArgv;
  assert.equal(isDirectExecution({ NETCATTY_INPUT_METHOD_VERIFIER: "1" }), true);
  assert.equal(runIfDirectExecution({
    env: { NETCATTY_INPUT_METHOD_VERIFIER: "1" },
    argv,
    runFn: (value) => { receivedArgv = value; return 0; },
  }), true);
  assert.equal(receivedArgv, argv);
});

test("requiring the verifier from a test runner does not execute it", () => {
  let called = false;
  assert.equal(runIfDirectExecution({
    env: {},
    argv: ["node", "test-runner.cjs"],
    runFn: () => { called = true; return 0; },
  }), false);
  assert.equal(called, false);
});

test("verifier writes a successful report through an atomic rename", () => {
  const writes = [];
  const renames = [];
  const exitCode = run(
    ["electron", "verifier", "bridge", "resources", "report.json"],
    {
      verifyFn: () => ({ supported: true, source: "packaged-workspace" }),
      writeFileSync: (...args) => writes.push(args),
      renameSync: (...args) => renames.push(args),
      logFn: () => {},
      errorFn: () => {},
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /^report\.json\.\d+\.tmp$/);
  assert.deepEqual(JSON.parse(writes[0][1]), {
    phase: "complete",
    supported: true,
    errorCode: null,
    source: "packaged-workspace",
    loadErrors: [],
  });
  assert.deepEqual(renames, [[writes[0][0], "report.json"]]);
});

test("verifier writes structured failure diagnostics to the output file", () => {
  let report;
  const exitCode = run(
    ["electron", "verifier", "bridge", "resources", "report.json"],
    {
      verifyFn: () => {
        const error = new Error("native load failed");
        error.phase = "native-adapter-load";
        error.details = {
          supported: false,
          errorCode: "native-module-unavailable",
          loadErrors: [{ source: "packaged-workspace", errorCode: "ERR_DLOPEN_FAILED" }],
        };
        throw error;
      },
      writeFileSync: (_path, value) => { report = JSON.parse(value); },
      renameSync: () => {},
      logFn: () => {},
      errorFn: () => {},
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(report, {
    phase: "native-adapter-load",
    supported: false,
    errorCode: "native-module-unavailable",
    source: null,
    loadErrors: [{ source: "packaged-workspace", errorCode: "ERR_DLOPEN_FAILED" }],
    error: "native load failed",
  });
});

test("writeReportAtomic writes before replacing the destination", () => {
  const operations = [];
  writeReportAtomic("report.json", { supported: true }, {
    writeFileSync: (path, value, encoding) => operations.push(["write", path, value, encoding]),
    renameSync: (from, to) => operations.push(["rename", from, to]),
  });
  assert.equal(operations[0][0], "write");
  assert.equal(operations[1][0], "rename");
  assert.equal(operations[1][2], "report.json");
});
