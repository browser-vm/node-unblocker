"use strict";

// Removed require("url") since the global URL constructor is used.

module.exports = function (config) {
  // occasionally things try to "fix" http:// in the path portion of the URL by merging the slashes and thereby breaking everything
  var RE_UNMERGE_SLASHES = /^(https?:\/)([^/])/i;
  // fix for #74 - fix cases where the /proxy/http:// part occurs twice - can happen with JS that tries to detect the protocol and build a URL from multiple strings
  // accepts 1-3 slashes in the middle (assuming the prefix starts with a slash)
  // note: the prefix only appears in the regex once because the other will have already been trimmed out.
  var RE_DUOBLE_PREFIX = new RegExp(
    "^https?:/?/?" + config.prefix + "(https?://)",
    "i"
  );

  // Define urlMapping so that it can be used in the module.
  const urlMapping = new Map();

  /**
   * Resolves a cloaked URL back to its original URL.
   */
  function getRealUrl(urlString) {
    // Remove merged slashes if needed.
    urlString = urlString.replace(RE_UNMERGE_SLASHES, "$1/$2");
    // Remove double prefix if present.
    urlString = urlString.replace(RE_DUOBLE_PREFIX, "$1");

    let realUrl;
    try {
      // Use the URL constructor; provide a base if the URL might be relative.
      realUrl = new URL(urlString, "http://example.com");
    } catch (err) {
      return null;
    }
    // Optionally store the mapping for further reference.
    urlMapping.set(urlString, realUrl.toString());
    return realUrl.toString();
  }

  return {
    getRealUrl: getRealUrl,
    urlMapping: urlMapping,
  };
};