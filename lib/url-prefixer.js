"use strict";

/**
 * This file creates a node.js Stream that re-writes chunks of HTML on-the-fly so that all
 * non-relative URLS are prefixed with the given string.
 *
 * For example, If you set the config.prefix to '/proxy/' and pass in this chunk of html:
 *   <a href="http://example.com/">link to example.com</a>
 * It would output this:
 *   <a href="/proxy/http://example.com/">link to example.com</a>
 *
 * It buffers a small amount of text from the end of each chunk to ensure that it properly
 * handles links that are split between two chunks (packets).
 */

const { URL } = require("url");
var Transform = require("stream").Transform;
var contentTypes = require("./content-types.js");
var crypto = require("crypto");
var debug = require("debug")("unblocker:url-prefixer");

const urlMapping = new Map(); // Store original and cloaked URLs

function urlPrefixer(config) {
  var re_abs_url = /("|'|=|url\(\s*)(https?:)/gi, // "http:, 'http:, =http:, or url( http:, also matches https versions
    // no need to match href="asdf/adf" relative links - those will work without modification

    // partial's dont cause anything to get changed, they just cause last few characters to be buffered and checked with the next batch
    re_html_partial = /((url\(\s*)?\s[^\s]+\s*)$/, // capture the last two "words" and any space after them handles chunks ending in things like `<a href=` and `background-image: url( ` or `url h`
    // things that shouldn't be proxied
    // (in order to keep this a little bit simpler, the initial regex proxies it, and then the second one unproxies it)
    // matches broken xmlns attributes like xmlns="/proxy/http://www.w3.org/1999/xhtml" and xmlns:og="/proxy/http://ogp.me/ns#"
    re_proxied_xmlns = new RegExp('(xmlns(:[a-z]+)?=")' + config.prefix, "ig"),
    re_proxied_doctype = new RegExp('(<!DOCTYPE[^>]+")' + config.prefix, "i");

  function rewriteUrls(chunk, uri, prefix) {
    // Helper function to generate a random hash
    function generateHash(url) {
      return crypto.createHash("sha256").update(url).digest("hex").slice(0, 8);
    }

    // Replace absolute URLs with cloaked versions
    chunk = chunk.replace(re_abs_url, (match, p1, url) => {
      const originalUrl = p1 + url;
      if (!urlMapping.has(originalUrl)) {
        const cloakedUrl = generateHash(originalUrl);
        urlMapping.set(cloakedUrl, originalUrl);
      }
      return `${p1}${prefix}${urlMapping.get(originalUrl)}`;
    });

    // Fix xmlns attributes that were broken because they contained URLs
    chunk = chunk.replace(re_proxied_xmlns, "$1");
    chunk = chunk.replace(re_proxied_doctype, "$1");

    return chunk;
  }

  function createStream(uri) {
    var chunk_remainder;

    return new Transform({
      decodeStrings: false,

      transform: function (chunk, encoding, next) {
        chunk = chunk.toString();
        if (chunk_remainder) {
          chunk = chunk_remainder + chunk;
          chunk_remainder = undefined;
        }

        // Buffer the end of the chunk if partial URLs are present
        var partial_hits = chunk.match(re_html_partial);
        if (partial_hits && partial_hits[1]) {
          var snip = partial_hits[1].length;
          chunk_remainder = chunk.substr(-1 * snip);
          chunk = chunk.substr(0, chunk.length - snip);
        }

        chunk = rewriteUrls(chunk, uri, config.prefix);

        // Inject click handler for cloaked links
        if (chunk.includes("</body>")) {
          chunk = chunk.replace(
            "</body>",
            `<script>
                        document.addEventListener('click', function(event) {
                            const target = event.target.closest('a');
                            if (target && target.href.includes('${config.prefix}')) {
                                const cloakedUrl = target.href.split('${config.prefix}')[1];
                                if (urlMapping.has(cloakedUrl)) {
                                    event.preventDefault();
                                    window.location.href = urlMapping.get(cloakedUrl);
                                }
                            }
                        });
                    </script></body>`
          );
        }

        this.push(chunk);
        next();
      },

      flush: function (done) {
        if (chunk_remainder) {
          this.push(rewriteUrls(chunk_remainder, uri, config.prefix));
          chunk_remainder = undefined;
        }
        done();
      },
    });
  }

  function prefixUrls(data) {
    if (contentTypes.shouldProcess(config, data)) {
      let uri;
      try {
        uri = new URL(data.url);
      } catch (e) {
        // if data.url isn’t absolute, provide a base fallback
        uri = new URL(data.url, "http://example.com");
      }
      debug("prefixing all urls with %s", config.prefix);
      data.stream = data.stream.pipe(createStream(uri));
    }
  }

  prefixUrls.rewriteUrls = rewriteUrls; // for testing
  prefixUrls.createStream = createStream;

  return prefixUrls;
}

module.exports = urlPrefixer;
