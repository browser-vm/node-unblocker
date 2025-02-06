"use strict";

var URL = require("url");

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
  /**
   * Resolves a cloaked URL back to its original URL.
   *
   * @param {string} cloakedUrl - The cloaked URL to resolve.
   * @returns {string} - The original URL if found, or throws an error if not found.
   */
  function resolveCloakedUrl(cloakedUrl) {
    if (urlMapping.has(cloakedUrl)) {
      return urlMapping.get(cloakedUrl);
    } else {
      throw new Error("Invalid or expired cloaked URL: " + cloakedUrl);
    }
  }

  /**
   * Takes a /proxy/http://site.com url or a cloaked URL from a request or a referer and returns the http://site.com/ part
   *
   * @todo: come up with a better name for this
   */
  function getRealUrl(path) {
    var uri = URL.parse(path),
      real_url = uri.path.substr(config.prefix.length);

    // Check if the URL is cloaked and resolve it
    if (urlMapping.has(real_url)) {
      real_url = resolveCloakedUrl(real_url);
    }

    real_url = real_url.replace(RE_DUOBLE_PREFIX, "$1");
    real_url = real_url.replace(RE_UNMERGE_SLASHES, "$1/$2");
    return real_url;
  }

  return getRealUrl;
};