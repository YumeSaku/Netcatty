"use strict";

const fs = require("node:fs");

function verifyPackagedInputMethod({ bridgePath, resourcesPath, requireFn = require }) {
  if (!bridgePath || !resourcesPath) {
    throw new Error("Expected packaged bridge and resources paths");
  }

  let bridge;
  try {
    bridge = requireFn(bridgePath);
  } catch (cause) {
    const error = new Error("Packaged bridge could not be required");
    error.phase = "packaged-bridge-require";
    error.causeDetails = {
      errorCode: typeof cause?.code === "string" ? cause.code : "bridge-require-error",
      error: cause?.message || String(cause),
    };
    throw error;
  }
  if (typeof bridge?.loadNativeInputMethodAdapter !== "function") {
    const error = new Error("Packaged bridge does not export loadNativeInputMethodAdapter");
    error.phase = "packaged-bridge-interface";
    throw error;
  }

  const result = bridge.loadNativeInputMethodAdapter({ resourcesPath });
  if (
    result?.supported !== true
    || result.adapter?.supported !== true
    || typeof result.adapter.getInputMethodStateForWindow !== "function"
    || typeof result.adapter.requestInputMethodStateForWindow !== "function"
  ) {
    const error = new Error("Packaged native input method adapter failed runtime loading");
    error.phase = "native-adapter-load";
    error.details = {
      supported: result?.supported,
      errorCode: result?.errorCode,
      source: result?.source,
      attemptedCandidates: result?.attemptedCandidates,
      loadErrors: result?.loadErrors,
    };
    throw error;
  }
  return { supported: true, source: result.source };
}

function sanitizeLoadErrors(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    source: item?.source,
    errorCode: item?.errorCode,
    error: item?.error,
  }));
}

function escapeWorkflowCommand(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function writeReportAtomic(
  reportPath,
  payload,
  { writeFileSync = fs.writeFileSync, renameSync = fs.renameSync } = {},
) {
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
  renameSync(temporaryPath, reportPath);
}

function run(argv = process.argv, dependencies = {}) {
  const [bridgePath, resourcesPath, reportPath] = argv.slice(2);
  const verifyFn = dependencies.verifyFn || verifyPackagedInputMethod;
  const logFn = dependencies.logFn || console.log;
  const errorFn = dependencies.errorFn || console.error;
  let exitCode = 0;
  let payload;
  try {
    const result = verifyFn({ bridgePath, resourcesPath });
    payload = {
      phase: "complete",
      supported: true,
      errorCode: null,
      source: result.source,
      loadErrors: [],
    };
    logFn(`[InputMethod] Packaged runtime load succeeded (${result.source}).`);
  } catch (error) {
    exitCode = 1;
    payload = {
      phase: error?.phase || "verifier",
      supported: error?.details?.supported === true,
      errorCode: error?.details?.errorCode || error?.causeDetails?.errorCode || "verification-failed",
      source: error?.details?.source || null,
      loadErrors: sanitizeLoadErrors(error?.details?.loadErrors),
      error: error?.message || String(error),
      ...(error?.causeDetails ? { cause: error.causeDetails } : {}),
    };
    errorFn(
      `::error title=Packaged input method runtime load failed::${escapeWorkflowCommand(JSON.stringify(payload))}`,
    );
  }

  if (!reportPath) return 1;
  try {
    writeReportAtomic(reportPath, payload, dependencies);
  } catch (error) {
    errorFn(`[InputMethod] Could not write verifier report: ${error?.message || error}`);
    return 1;
  }
  return exitCode;
}

function isDirectExecution(env = process.env) {
  return env.NETCATTY_INPUT_METHOD_VERIFIER === "1";
}

function runIfDirectExecution({ env = process.env, argv = process.argv, runFn = run } = {}) {
  if (!isDirectExecution(env)) return false;
  process.exitCode = runFn(argv);
  return true;
}

runIfDirectExecution();

module.exports = {
  escapeWorkflowCommand,
  isDirectExecution,
  run,
  runIfDirectExecution,
  verifyPackagedInputMethod,
  writeReportAtomic,
};
