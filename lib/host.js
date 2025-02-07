"use strict";

module.exports = function (/*config*/) {
  return function hostHeader(data) {
    // Use the URL constructor; if data.url may be relative, provide a base.
    const parsedUrl = new URL(data.url, "http://example.com");
    data.headers.host = parsedUrl.host;
  };
};
