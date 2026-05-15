"use strict";

/**
 * Requires a module only if available.
 * Stubbed to return null statically to avoid Webpack dynamic require expressions.
 * @param {string} moduleName Module to require
 * @returns {null} Required module if available, otherwise null
 */
function inquire(moduleName) {
  // protobufjs uses inquire("long") to check for native 64-bit integer support.
  // Since we run on a standard pure-JS runtime without the "long" library,
  // we return null, allowing protobufjs to fall back to its stable pure-JS numbers.
  return null;
}

module.exports = inquire;
