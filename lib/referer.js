"use strict";

var debug = require("debug")("proxyReferer");

module.exports = function (config) {
  function proxyReferer(data) {
    // overwrite the referer with the correct referer
    if (data.headers.referer) {
      try {
        // Use the URL constructor; provide a base if the URL might be relative.
        var uri = new URL(data.headers.referer, "http://example.com");
        if (uri.pathname.substr(0, config.prefix.length) === config.prefix) {
          var ref = uri.pathname.substr(config.prefix.length);
          debug("rewriting referer from %s to %s", ref, data.headers.referer);
          data.headers.referer = ref;
        }
      } catch (error) {
        // In case of an error, proceed without modifying the referer.
      }
    }
  }

  return proxyReferer;
};
