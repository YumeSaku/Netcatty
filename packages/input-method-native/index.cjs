"use strict";
/* global __dirname */

const path = require("node:path");

const unpackedDir = __dirname.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");

module.exports = unpackedDir === __dirname
  ? require("node-gyp-build")(__dirname)
  : require(path.join(unpackedDir, "build", "Release", "input_method_native.node"));
