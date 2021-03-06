var os = require('os');
var http = require('http');
var https = require('https');
var owns = {}.hasOwnProperty;

http.globalAgent.maxSockets = 20; //default limitation is only 5 connections in the same time. It's too low for high-load applications.

module.exports = function proxyMiddleware(options) {

  var httpLib = options.protocol === 'https:' ? https : http;
  var request = httpLib.request;
  options = options || {};
  options.hostname = options.hostname;
  options.port = options.port;

  return function (req, resp, next) {
  
     //connection can be terminated by browser before proxy establish connection.
     //in this case we shouldn't send any request
     var isTerminated = false;
     resp.on('close', function () { 
           isTerminated = true;
           return;
        });
  
    var url = req.url;
    // You can pass the route within the options, as well
    if (typeof options.route === 'string') {
      var route = slashJoin(options.route, '');
      if (url.slice(0, route.length) === route) {
        url = url.slice(route.length);
      } else {
        return next();
      }
    }

    //options for this request
    var opts = extend({}, options);
    opts.path = slashJoin(options.pathname, url);
    opts.method = req.method;
    opts.headers = options.headers ? merge(req.headers, options.headers) : req.headers;

    applyViaHeader(req.headers, opts, opts.headers);

    // Forwarding the host breaks dotcloud
    delete opts.headers.host;

    var myReq = request(opts, function (myRes) {
	   if (isTerminated) {
           myRes.unpipe();
           myReq.abort();
           return;
        }
			
      var statusCode = myRes.statusCode
        , headers = myRes.headers
        , location = headers.location;
      // Fix the location
      if (statusCode > 300 && statusCode < 304 && location.indexOf(options.href) > -1) {
        // absoulte path
        headers.location = location.replace(options.href, slashJoin('', slashJoin((options.route || ''), '')));
      }
      applyViaHeader(myRes.headers, opts, myRes.headers);
      rewriteCookieHosts(myRes.headers, opts, myRes.headers, req);
      resp.writeHead(myRes.statusCode, myRes.headers);
      myRes.on('error', function (err) {
        next(err);
      });
	  resp.removeAllListeners('close');
      resp.on('close', function () { //connection terminated during the request piping
            myRes.unpipe();
            myReq.abort();

            next();
        });
      myRes.pipe(resp);
    });
    myReq.on('error', function (err) {
      next(err);
    });
    if (!req.readable) {
      myReq.end();
    } else {
      req.pipe(myReq);
    }
  };
};

function applyViaHeader(existingHeaders, opts, applyTo) {
  if (!opts.via) return;

  var viaName = (true === opts.via) ?  os.hostname() : opts.via;
  var viaHeader = '1.1 ' + viaName;
  if(existingHeaders.via) {
    viaHeader = existingHeaders.via + ', ' + viaHeader;
  }

  applyTo.via = viaHeader;
}

function rewriteCookieHosts(existingHeaders, opts, applyTo, req) {
  if (!opts.cookieRewrite || !owns.call(existingHeaders, 'set-cookie')) {
    return;
  }

  var existingCookies = existingHeaders['set-cookie'],
      rewrittenCookies = [],
      rewriteHostname = (true === opts.cookieRewrite) ? os.hostname() : opts.cookieRewrite;

  if (!Array.isArray(existingCookies)) {
    existingCookies = [ existingCookies ];
  }

  for (var i = 0; i < existingCookies.length; i++) {
    var rewrittenCookie = existingCookies[i].replace(/(Domain)=[a-z\.-_]*?(;|$)/gi, '$1=' + rewriteHostname + '$2');

    if (!req.connection.encrypted) {
      rewrittenCookie = rewrittenCookie.replace(/;\s*?(Secure)/, '');
    }
    rewrittenCookies.push(rewrittenCookie);
  }

  applyTo['set-cookie'] = rewrittenCookies;
}

function slashJoin(p1, p2) {
  if (p1.length && p1[p1.length - 1] === '/') {p1 = p1.substring(0, p1.length - 1); }
  if (p2.length && p2[0] === '/') {p2 = p2.substring(1); }
  return p1 + '/' + p2;
}

function extend(obj, src) {
  for (var key in src) if (owns.call(src, key)) obj[key] = src[key];
  return obj;
}

//merges data without changing state in either argument
function merge(src1, src2) {
    var merged = {};
    extend(merged, src1);
    extend(merged, src2);
    return merged;
}
