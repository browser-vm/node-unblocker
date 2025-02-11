"use strict";

var _ = require("lodash");
var debug = require("debug")("unblocker:core");
var debugWS = require("debug")("unblocker:websocket");
var middlewareDebugger = require("./middleware-debugger.js");
const url = require("url");

// Define UnblockerCore (if not previously defined)
var UnblockerCore = {};

// expose all built-in middleware
UnblockerCore.host = require("./host.js");
UnblockerCore.referer = require("./referer.js");
UnblockerCore.cookies = require("./cookies.js");
UnblockerCore.hsts = require("./hsts.js");
UnblockerCore.hpkp = require("./hpkp.js");
UnblockerCore.csp = require("./csp.js");
UnblockerCore.redirects = require("./redirects.js");

UnblockerCore.decompress = require("./decompress.js");
UnblockerCore.charsets = require("./charsets.js");
UnblockerCore.urlPrefixer = require("./url-prefixer.js");
UnblockerCore.clientScripts = require("./client-scripts.js");
UnblockerCore.metaRobots = require("./meta-robots.js");
UnblockerCore.contentLength = require("./content-length.js");

// these aren't middleware, but are still worth exposing
UnblockerCore.proxy = require("./proxy.js");
UnblockerCore.contentTypes = require("./content-types.js");
UnblockerCore.getRealUrl = require("./get-real-url.js");
UnblockerCore.websockets = require("./websockets.js");

var defaultConfig = {
  prefix: "/proxy/",
  host: null, // can be used to override the url used in redirects
  requestMiddleware: [],
  responseMiddleware: [],
  standardMiddleware: true,
  clientScripts: true, // note: disabling standardMiddleware also disables clientScripts. It's mostly in a separate setting for testing
  processContentTypes: UnblockerCore.contentTypes.html.concat(
    UnblockerCore.contentTypes.css
  ),
};

function Unblocker(config) {
  _.defaults(config, defaultConfig);

  if (config.prefix.substr(-1) != "/") {
    config.prefix += "/";
  }

  if (config.standardMiddleware !== false) {
    var host = UnblockerCore.host(config);
    var referer = UnblockerCore.referer(config);
    var cookies = UnblockerCore.cookies(config);
    var hsts = UnblockerCore.hsts(config);
    var hpkp = UnblockerCore.hpkp(config);
    var csp = UnblockerCore.csp(config);
    var redirects = UnblockerCore.redirects(config);
    var decompress = UnblockerCore.decompress(config);
    var charsets = UnblockerCore.charsets(config);
    var urlPrefixer = UnblockerCore.urlPrefixer(config);
    var metaRobots = UnblockerCore.metaRobots(config);
    var contentLength = UnblockerCore.contentLength(config);

    // this applies to every request that gets proxied
    config.requestMiddleware = [
      host,
      referer,
      decompress.handleRequest,
      cookies.handleRequest,
    ].concat(config.requestMiddleware);

    config.responseMiddleware = [
      hsts,
      hpkp,
      csp,
      redirects,
      decompress.handleResponse,
      charsets,
      urlPrefixer,
      cookies.handleResponse,
      metaRobots,
    ].concat(config.responseMiddleware, [contentLength]);

    var clientScripts;
    if (config.clientScripts) {
      // insert clientScripts after the urlPrefixer
      clientScripts = UnblockerCore.clientScripts(config);
      const position = config.responseMiddleware.indexOf(urlPrefixer) + 1;
      config.responseMiddleware.splice(position, 0, clientScripts.injector);
    }
  }

  // the middleware debugger logs details before/after each piece of middleware
  if (middlewareDebugger.enabled) {
    config.requestMiddleware = middlewareDebugger.debugMiddleware(
      config.requestMiddleware,
      "request"
    );
    config.responseMiddleware = middlewareDebugger.debugMiddleware(
      config.responseMiddleware,
      "response"
    );
  }

  debug("Unblocker initialized, config: ", config);

  var proxy = UnblockerCore.proxy(config);

  var getRealUrl = UnblockerCore.getRealUrl(config);

  /**
   * This is what makes this server magic: if we get an unrecognized request that wasn't corrected by
   * proxy's filter, this checks the referrer to determine what the path should be, and then issues a
   * 307 redirect to a proxied url at that path
   *
   * 307 redirects cause the client to re-use the original method and body at the new location
   */
  function recoverTargetUrl(request) {
    if (request.url.indexOf(config.prefix) === 0) {
      // handles /proxy/ and /proxy
      if (
        request.url == config.prefix ||
        request.url == config.prefix.substr(0, config.prefix.length - 1)
      ) {
        return null;
      }
      // handles cases like like /proxy/google.com and redirects to /proxy/http://google.com/
      return "http://" + request.url.substr(config.prefix.length);
    }

    // if there is no referer, then either they just got here or we can't help them
    if (!request.headers.referer) {
      return null;
    }

    var ref = url.parse(request.headers.referer);

    // if we couldn't parse the referrer or they came from another site, they send them to the home page
    if (!ref || ref.host != thisHost(request)) {
      return null;
    }

    // now we know where they came from, so we can do something for them
    if (ref.pathname.indexOf(config.prefix + "http") === 0) {
      var real_url = getRealUrl(ref.pathname);
      let target_url = null;
      try {
        const real_uri = new URL(real_url);
        target_url = real_uri.protocol + "//" + real_uri.host + request.url;
      } catch (e) {
        // Handle invalid URL if needed
      }
      debug("recovering broken link to %s", request.url);
      // now, take the requested pat on the previous known host and send the user on their way
      return target_url;
    }

    // fallback - there was a referer, but it wasn't one that we could use to determine the correct path
    return null;
  }

  // returns the configured host if one exists, otherwise the host that the current request came in on
  function thisHost(request) {
    if (config.host) {
      return config.host;
    } else {
      return request.headers.host; // normal case: include the hostname but assume we're either on a standard port or behind a reverse proxy
    }
  }

  // returns the http://site.com/proxy
  function thisSite(request) {
    // default to express's more advanced version of this when available (handles X-Forwarded-Protocol headers)
    const proto =
      request.protocol ||
      request.headers["X-Forwarded-Protocol"] ||
      (request.connection.encrypted ? "https" : "http");
    return proto + "://" + thisHost(request) + config.prefix;
  }

  function redirectTo(request, response, site, headers) {
    site = site || "";
    if (site.substr(0, 1) == "/") {
      site = site.substr(1);
    }
    if (site.substr(0, config.prefix.length) == config.prefix) {
      // no /proxy/proxy redirects
      site = site.substr(config.prefix.length);
    }
    var location = request.thisSite() + site;
    debug("redirecting to %s", location);
    try {
      response.writeHead(
        307,
        _.defaults(headers || {}, {
          Location: location,
        })
      );
    } catch (ex) {
      // Most likely because the headers were already sent
      console.error("Failed to send redirect", ex);
    }
    response.end();
  }

  function initData(clientRequest, clientResponse, clientSocket) {
    // convenience methods
    clientRequest.thisHost = thisHost.bind(thisHost, clientRequest);
    clientRequest.thisSite = thisSite.bind(thisSite, clientRequest);

    var uri,
      formatted = null;
    var url_data = url.parse(clientRequest.url);
    var rawUrl = clientRequest.url.substr(config.prefix.length);

    // todo: consider supporting ws here for websockets
    if (url_data.pathname.indexOf(config.prefix + "http") === 0) {
      uri = url.parse(getRealUrl(clientRequest.url));
      formatted = url.format(uri);
    } else {
      var target = recoverTargetUrl(clientRequest);
      if (target) {
        // redirecting is dificult here, and doesn't add much value, so just use the recovered target url
        uri = url.parse(target);
        formatted = url.format(uri);
      }
    }

    // todo: check the TLD to handle cases where a client requested ../img.jpg from the root and this gets translated to /proxy/http://img.jpg by the browser.
    // (surviv.io does this)

    // This is how api consumers can hook into requests.
    // The data object is passed to all requestMiddleware before the request is sent to the remote server,
    // and it is passed through all responseMiddleware before being sent to the client.
    var data = {
      url: formatted,
      uri,
      rawUrl,
      clientRequest,
      clientResponse,
      headers: _.cloneDeep(clientRequest.headers),
      stream: clientRequest,
      isWebsocket: !!clientSocket,
      clientSocket,
    };

    return data;
  }

  // todo: see if this can be synchronous
  const clientScriptsServer = config.clientScripts
    ? clientScripts.server
    : (req, res, next) => next();

  // regular web requests
  function handleRequest(clientRequest, clientResponse, next) {
    const data = initData(clientRequest, clientResponse);

    clientScriptsServer(clientRequest, clientResponse, (err) => {
      if (err) return next(err);

      clientResponse.redirectTo = redirectTo.bind(
        redirectTo,
        clientRequest,
        clientResponse
      );

      if (!next) {
        next = function () {
          clientResponse.writeHead(400);
          clientResponse.end("Unable to process request");
        };
      }

      const formatted = data.url;
      const raw = data.rawUrl;

      if (formatted) {
        // If the raw URL isn't quite right, but we can figure it out, redirect to the correct URL.
        // Special exception for cases where routers collapsed slashes (see #130)
        if (formatted !== raw && formatted.replace("://", ":/") !== raw) {
          return clientResponse.redirectTo(formatted);
        }

        proxy(data, next);
      } else {
        next();
      }
    });
  }

  // websocket support
  const proxyWebsocket = UnblockerCore.websockets(config);

  handleRequest.onUpgrade = function onUpgrade(
    clientRequest,
    clientSocket,
    clientHead
  ) {
    debugWS("handling websocket req to", clientRequest.url);

    const data = initData(clientRequest, null, clientSocket);

    data.clientHead = clientHead;

    if (data.url) {
      proxyWebsocket(data);
    } else {
      // nothing else to do, we don't know where the websocket is supposed to go.
      debugWS("unable to handle websocket upgrade", clientRequest.url);
      clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  };

  return handleRequest;
}

module.exports = Unblocker;
module.exports.defaultConfig = defaultConfig;
