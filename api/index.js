const http = require("http");
const https = require("https");
const { URL } = require("url");

const MISC_DOMAIN = process.env.MISC_DOMAIN || "example.com";
const PORT = process.env.PORT || 3000;
const AUTH = process.env.AUTH || "dXNlcjo="; // user:

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

function handleRequest(req, res) {
  console.log(req)
  const host = req.headers.host || "";
  const url = new URL(req.url, `http://${host}`);

  console.log(`${req.method} ${host}${url.pathname}`);

  // g.domain - Google proxy
  if (host === `g.${MISC_DOMAIN}`) {
    proxyRequest(
      req,
      res,
      `https://www.google.com${url.pathname}${url.search}`,
      {
        replacements: [
          ["//en.wikipedia.org", `//${MISC_DOMAIN.replace("g.", "wiki.")}`],
          ["//zh.wikipedia.org", `//${MISC_DOMAIN.replace("g.", "wikizh.")}`],
          ["//github.com", `//${MISC_DOMAIN.replace("g.", "gh.")}`],
        ],
      },
    );
    return;
  }

  // gh.domain - GitHub proxy (authentication required)
  if (host === `gh.${MISC_DOMAIN}`) {
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
        ["https://raw.githubusercontent.com", `https://ghraw.${MISC_DOMAIN}`],
      ],
      replacements: [["//github.com", `//gh.${MISC_DOMAIN}`]],
    });
    return;
  }

  // ghraw.domain - GitHub Raw proxy
  if (host === `ghraw.${MISC_DOMAIN}`) {
    proxyRequest(
      req,
      res,
      `https://raw.githubusercontent.com${url.pathname}${url.search}`,
    );
    return;
  }

  // wiki.domain - Wikipedia EN proxy
  if (host === `wiki.${MISC_DOMAIN}`) {
    proxyRequest(
      req,
      res,
      `https://en.wikipedia.org${url.pathname}${url.search}`,
      {
        locationReplacements: [
          ["https://en.wikipedia.org", `https://wiki.${MISC_DOMAIN}`],
          ["https://zh.wikipedia.org", `https://wikizh.${MISC_DOMAIN}`],
        ],
        replacements: [
          ["//en.wikipedia.org", `//wiki.${MISC_DOMAIN}`],
          ["//zh.wikipedia.org", `//wikizh.${MISC_DOMAIN}`],
          ["//upload.wikimedia.org", `//wikiupload.${MISC_DOMAIN}`],
        ],
      },
    );
    return;
  }

  // wikizh.domain - Wikipedia ZH proxy
  if (host === `wikizh.${MISC_DOMAIN}`) {
    proxyRequest(
      req,
      res,
      `https://zh.wikipedia.org${url.pathname}${url.search}`,
      {
        locationReplacements: [
          ["https://en.wikipedia.org", `https://wiki.${MISC_DOMAIN}`],
          ["https://zh.wikipedia.org", `https://wikizh.${MISC_DOMAIN}`],
        ],
        replacements: [
          ["//en.wikipedia.org", `//wiki.${MISC_DOMAIN}`],
          ["//zh.wikipedia.org", `//wikizh.${MISC_DOMAIN}`],
          ["//upload.wikimedia.org", `//wikiupload.${MISC_DOMAIN}`],
        ],
      },
    );
    return;
  }

  // wikiupload.domain - Wikimedia Upload proxy
  if (host === `wikiupload.${MISC_DOMAIN}`) {
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
  console.log(`MISC_DOMAIN: ${MISC_DOMAIN}`);
});
