"use strict";

/* eslint-disable node/no-unsupported-features/node-builtins */

module.exports = function ({ allowedDomains, message }) {
  function isRequestAllowed(data) {
    let hostname;
    try {
      // Use the URL constructor; if data.url may be relative, provide a base.
      const parsedUrl = new URL(data.url, "http://example.com");
      hostname = parsedUrl.hostname;
    } catch (error) {
      return false;
    }
    return allowedDomains.some(
      (allowedDomain) =>
        hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`)
    );
  }

  function checkWhitelist(data) {
    if (!isRequestAllowed(data)) {
      data.clientResponse.status(400).send(message);
    }
  }

  return {
    checkWhitelist,
  };
};
