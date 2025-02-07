"use strict";

const URL = require("url");

/**
 * Example blacklist for node-unblocker.
 */

function isBlacklisted(req) {
  let parsedUrl;
  try {
    // Use the URL constructor; adjust the base URL as needed.
    parsedUrl = new URL(req.url, "http://example.com");
  } catch (error) {
    return false;
  }

  // Sample blacklist, update as appropriate.
  const blacklistedHosts = [
    "example.com",
    "malicious.com"
  ];

  // Check if the hostname is blacklisted.
  const checkBlacklist = blacklistedHosts.includes(parsedUrl.hostname);
  return checkBlacklist;
}

module.exports = isBlacklisted;
