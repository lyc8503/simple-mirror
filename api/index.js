const http = require("http");
const https = require("https");
const { URL } = require("url");
const url = require("url");
const fs = require('fs');

const PROXY_DOMAIN = process.env.PROXY_DOMAIN || 'exmaple.com';
const PORT = process.env.PORT || 3000;
const AUTH = process.env.AUTH || "dXNlcjo="; // user:
const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID || '';
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || '';

function checkAuth(req) {
  const authHeader = req.headers.authorization;
  const expectedAuth = "Basic " + AUTH;
  return authHeader === expectedAuth;
}

function proxyRequest(req, res, targetUrl, options = {}) {
  const target = new URL(targetUrl);

  const proxyOptions = {
    hostname: target.hostname,
    port: target.port || 443,
    path: target.pathname + target.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.hostname,
      "accept-encoding": "identity",
    },
  };

  // Remove original host headers
  delete proxyOptions.headers["host"];
  proxyOptions.headers["host"] = target.hostname;

  const proxyReq = https.request(proxyOptions, (proxyRes) => {
    let body = "";

    // Process response headers
    const responseHeaders = { ...proxyRes.headers };

    // Remove CSP
    delete responseHeaders["content-security-policy"];

    // Handle Location redirect
    if (options.locationReplacements && responseHeaders.location) {
      for (const [from, to] of options.locationReplacements) {
        responseHeaders.location = responseHeaders.location.replace(from, to);
      }
    }

    // If content replacement is needed, collect complete response first
    if (options.replacements) {
      proxyRes.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });

      proxyRes.on("end", () => {
        // Perform content replacement
        for (const [from, to] of options.replacements) {
          body = body.replace(new RegExp(from.replace(/\//g, "\\/"), "g"), to);
        }

        delete responseHeaders["content-length"];
        res.writeHead(proxyRes.statusCode, responseHeaders);
        res.end(body);
      });
    } else {
      // No content replacement needed, forward directly
      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Bad Gateway");
  });

  // Forward request body
  req.pipe(proxyReq);
}

function serveGoogleSearch(req, res) {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  // Route 1: Root path, serves the HTML page
  if (pathname === '/') {
      fs.readFile('google.html', (err, data) => {
          if (err) {
              res.writeHead(500, { 'Content-Type': 'text/plain' });
              res.end('Error loading html');
              return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
      });
  } 
  // Route 2: Search API proxy
  else if (pathname === '/api/search') {
      const query = parsedUrl.query.q;
      const start = parsedUrl.query.start || '1';

      if (!query) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Query parameter "q" is required' }));
          return;
      }

      const googleApiUrl = `https://www.googleapis.com/customsearch/v1?key=${SEARCH_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&start=${start}`;
      
      // Make a request to the Google API and pipe the response back to the client.
      https.get(googleApiUrl, (apiRes) => {
          res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
          apiRes.pipe(res, { end: true });
      }).on('error', (e) => {
          console.error(`Got error: ${e.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to fetch search results.' }));
      });
  }
  // Route 3: Resource proxy (for images, favicons)
  else if (pathname === '/proxy/resource') {
      const resourceUrl = parsedUrl.query.url;

      if (!resourceUrl) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('URL parameter is required');
          return;
      }
      
      try {
          const proxiedUrl = new URL(resourceUrl);

          // Request the resource and pipe it back to the client.
          https.get(proxiedUrl.href, (resourceRes) => {
              const contentType = resourceRes.headers['content-type'] || 'application/octet-stream';
              res.writeHead(resourceRes.statusCode, { 'Content-Type': contentType });
              resourceRes.pipe(res, { end: true });
          }).on('error', (e) => {
              console.error(`Proxy error: ${e.message}`);
              res.writeHead(502, { 'Content-Type': 'text/plain' });
              res.end('Bad Gateway');
          });

      } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid URL');
      }
  }
  // Route 4: 404 Not Found for any other path
  else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
  }
}

function handleRequest(req, res) {
  const host = req.headers.host || "";
  const url = new URL(req.url, `http://${host}`);
  const subdomain = host.split('.')[0]

  console.log(`${req.method} ${host}${url.pathname}`);

  // g.domain - Google proxy
  if (subdomain === `g`) {
    serveGoogleSearch(req, res);
    return;
  }

  // gh.domain - GitHub proxy (authentication required)
  if (subdomain === `gh`) {
    if (!checkAuth(req)) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Username required"',
        "Content-Type": "text/plain",
      });
      res.end("Unauthorized");
      return;
    }

    proxyRequest(req, res, `https://github.com${url.pathname}${url.search}`, {
      locationReplacements: [
        ["https://raw.githubusercontent.com", `https://ghraw.${PROXY_DOMAIN}`],
      ],
      replacements: [["//github.com", `//gh.${PROXY_DOMAIN}`]],
    });
    return;
  }

  // ghraw.domain - GitHub Raw proxy
  if (subdomain === `ghraw`) {
    proxyRequest(
      req,
      res,
      `https://raw.githubusercontent.com${url.pathname}${url.search}`,
    );
    return;
  }

  // wiki.domain - Wikipedia EN proxy
  if (subdomain === `wiki`) {
    proxyRequest(
      req,
      res,
      `https://en.wikipedia.org${url.pathname}${url.search}`,
      {
        locationReplacements: [
          ["https://en.wikipedia.org", `https://wiki.${PROXY_DOMAIN}`],
          ["https://zh.wikipedia.org", `https://wikizh.${PROXY_DOMAIN}`],
        ],
        replacements: [
          ["//en.wikipedia.org", `//wiki.${PROXY_DOMAIN}`],
          ["//zh.wikipedia.org", `//wikizh.${PROXY_DOMAIN}`],
          ["//upload.wikimedia.org", `//wikiupload.${PROXY_DOMAIN}`],
        ],
      },
    );
    return;
  }

  // wikizh.domain - Wikipedia ZH proxy
  if (subdomain === `wikizh`) {
    proxyRequest(
      req,
      res,
      `https://zh.wikipedia.org${url.pathname}${url.search}`,
      {
        locationReplacements: [
          ["https://en.wikipedia.org", `https://wiki.${PROXY_DOMAIN}`],
          ["https://zh.wikipedia.org", `https://wikizh.${PROXY_DOMAIN}`],
        ],
        replacements: [
          ["//en.wikipedia.org", `//wiki.${PROXY_DOMAIN}`],
          ["//zh.wikipedia.org", `//wikizh.${PROXY_DOMAIN}`],
          ["//upload.wikimedia.org", `//wikiupload.${PROXY_DOMAIN}`],
        ],
      },
    );
    return;
  }

  // wikiupload.domain - Wikimedia Upload proxy
  if (subdomain === `wikiupload`) {
    proxyRequest(
      req,
      res,
      `https://upload.wikimedia.org${url.pathname}${url.search}`,
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}


// For vercel
module.exports = handleRequest;

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
