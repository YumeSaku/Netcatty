import test from "node:test";
import assert from "node:assert/strict";

import { getAlignedPrompt } from "./autocomplete/promptDetector.ts";

function createFakeTerm(lineText: string, cursorX: number) {
  return {
    buffer: {
      active: {
        cursorX,
        cursorY: 0,
        baseY: 0,
        getLine(line: number) {
          if (line !== 0) return undefined;
          return {
            isWrapped: false,
            translateToString() {
              return lineText;
            },
          };
        },
      },
    },
  };
}

test("prefers the typed buffer when shell echo is still one character behind", () => {
  const term = createFakeTerm("$ do", 4);

  const result = getAlignedPrompt(term as never, "doc", true);

  assert.equal(result.prompt.isAtPrompt, true);
  assert.equal(result.prompt.promptText, "$ ");
  assert.equal(result.prompt.userInput, "doc");
  assert.equal(result.prompt.cursorOffset, 3);
  assert.equal(result.alignedTyped, "doc");
});

test("still trims prompt decorations out of the detected input", () => {
  const term = createFakeTerm("➜  ~ do", 7);

  const result = getAlignedPrompt(term as never, "do", true);

  assert.equal(result.prompt.isAtPrompt, true);
  assert.equal(result.prompt.promptText, "➜  ~ ");
  assert.equal(result.prompt.userInput, "do");
  assert.equal(result.prompt.cursorOffset, 2);
  assert.equal(result.alignedTyped, "do");
});

test("detects oh-my-posh Nerd Font chevron (U+F105) prompt terminator", () => {
  // Real-world PS1 captured from oh-my-posh themed bash on a server:
  //   "<U+F31B> root@oracle ~ <U+F105> " then user input
  const term = createFakeTerm(" root@oracle ~  ls", 21);

  const result = getAlignedPrompt(term as never, "ls", true);

  assert.equal(result.prompt.isAtPrompt, true);
  assert.equal(result.prompt.promptText, " root@oracle ~  ");
  assert.equal(result.prompt.userInput, "ls");
});

test("detects Powerline right-arrow (U+E0B0) prompt terminator", () => {
  // oh-my-posh agnoster-style: colored block ending with U+E0B0 + space
  const term = createFakeTerm(" root  ~  git", 16);

  const result = getAlignedPrompt(term as never, "git", true);

  assert.equal(result.prompt.isAtPrompt, true);
  assert.equal(result.prompt.userInput, "git");
  assert.ok(result.prompt.promptText.endsWith(" "));
});

test("PUA char without trailing space is not a prompt boundary", () => {
  // A bare PUA glyph mid-token (e.g. paste artifact) should not trigger detection.
  const term = createFakeTerm("echo foo", 13);

  const result = getAlignedPrompt(term as never, "", true);

  assert.equal(result.prompt.isAtPrompt, false);
});
