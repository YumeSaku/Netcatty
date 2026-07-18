"use strict";

function verifyPackagedInputMethod({ bridgePath, resourcesPath, requireFn = require }) {
  if (!bridgePath || !resourcesPath) {
    throw new Error("Expected packaged bridge and resources paths");
  }

  const bridge = requireFn(bridgePath);
  if (typeof bridge?.loadNativeInputMethodAdapter !== "function") {
    throw new Error("Packaged bridge does not export loadNativeInputMethodAdapter");
  }

  const result = bridge.loadNativeInputMethodAdapter({ resourcesPath });
  if (
    result?.supported !== true
    || result.adapter?.supported !== true
    || typeof result.adapter.getInputMethodStateForWindow !== "function"
    || typeof result.adapter.requestInputMethodStateForWindow !== "function"
  ) {
    const error = new Error("Packaged native input method adapter failed runtime loading");
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

function escapeWorkflowCommand(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function run(argv = process.argv) {
  const [bridgePath, resourcesPath] = argv.slice(2);
  try {
    const result = verifyPackagedInputMethod({ bridgePath, resourcesPath });
    console.log(`[InputMethod] Packaged runtime load succeeded (${result.source}).`);
    return 0;
  } catch (error) {
    const details = error?.details ? ` ${JSON.stringify(error.details)}` : "";
    console.error(
      `::error title=Packaged input method runtime load failed::${escapeWorkflowCommand(`${error?.message || error}${details}`)}`,
    );
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  escapeWorkflowCommand,
  run,
  verifyPackagedInputMethod,
};
