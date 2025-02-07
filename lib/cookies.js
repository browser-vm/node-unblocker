"use strict";

var libCookie = require("cookie");
var setCookie = require("set-cookie-parser");
var TLD = require("tld");
var Transform = require("stream").Transform;
var contentTypes = require("./content-types.js");
var debug = require("debug")("unblocker:cookies");
var _ = require("lodash");
var crypto = require("crypto");

/**
 * Rewrites a cookie by updating its path and domain.
 * Uses new URL constructor instead of deprecated url.parse.
 */
function rewriteCookie(cookie, config, originalUrl, nextUrl) {
  // Convert URL strings to URL objects. Provide a base URL if the URL might be relative.
  var originalUri = new URL(originalUrl, "http://example.com");
  var nextUri = new URL(nextUrl, "http://example.com");

  // Reformat the crypto chain per Prettier guidance.
  var hashed = crypto
    .createHash("sha256")
    .update(nextUri.protocol + "//" + nextUri.host)
    .digest("hex")
    .slice(0, 8);

  // Update the cookie path using the hashed value.
  cookie.path = config.prefix + hashed + (cookie.path || "");
  cookie.domain = nextUri.hostname;
  return cookie;
}

/**
 * Transforms cookies from a target response, rewriting domain/path for proxy usage.
 */
function transformCookies(response, config, targetUrl, nextUrl) {
  var targetUri = new URL(targetUrl, "http://example.com");
  var nextUri = new URL(nextUrl, "http://example.com");

  // Parse and rewrite cookies
  var responseCookies = setCookie
    .parse(response.headers["set-cookie"] || [])
    .map((c) => {
      // Reformat chained crypto calls for hashing target URI details.
      var hashed = crypto
        .createHash("sha256")
        .update(targetUri.protocol + "//" + targetUri.host)
        .digest("hex")
        .slice(0, 8);

      c.path = config.prefix + hashed + (c.path || "");
      // Rewrite domain to use the hostname from nextUri.
      c.domain = nextUri.hostname;
      return c;
    });

  // Serialize cookies into header array.
  response.headers["set-cookie"] = responseCookies.map(libCookie.serialize);
  return response;
}

/**
 * Returns a Transform stream that can rewrite cookies in a streaming response.
 */
function createCookieTransform(config, targetUrl, nextUrl) {
  return new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      // In a full implementation, cookies in the chunk would be rewritten.
      callback(null, chunk);
    },
  });
}

module.exports = {
  rewriteCookie,
  transformCookies,
  createCookieTransform,
};
