const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");

const PROXY_DOMAIN = process.env.PROXY_DOMAIN || "exmaple.com";
const PORT = process.env.PORT || 3000;
const AUTH = process.env.AUTH || "dXNlcjo="; // user:
const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID || "";
const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";

const GOOGLE_SEARCH_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Google Search Clone</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #fff; }
        .container { max-width: 600px; margin: 0 auto; }
        .logo { text-align: center; margin-bottom: 20px; }
        .logo img { width: 272px; height: 92px; }
        .search-bar { display: flex; justify-content: center; margin-bottom: 20px; }
        .search-bar input[type="text"] { width: 100%; padding: 10px; border: 1px solid #dfe1e5; border-radius: 24px; outline: none; font-size: 16px; }
        .search-bar input[type="text"]:hover, .search-bar input[type="text"]:focus { box-shadow: 0 1px 6px rgba(32, 33, 36, 0.28); border-color: rgba(223, 225, 229, 0); }
        .buttons { text-align: center; margin-top: 20px; }
        .buttons button { background-color: #f8f9fa; border: 1px solid #f8f9fa; border-radius: 4px; color: #3c4043; font-family: arial, sans-serif; font-size: 14px; margin: 11px 4px; padding: 0 16px; line-height: 27px; height: 36px; min-width: 54px; text-align: center; cursor: pointer; user-select: none; }
        .buttons button:hover { box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1); background-color: #f8f9fa; border: 1px solid #dadce0; color: #202124; }
        #results { margin-top: 40px; }
        .result-item { margin-bottom: 24px; }
        .favicon { width: 16px; height: 16px; margin-right: 8px; vertical-align: middle; }
        .result-source { display: flex; align-items: center; margin-bottom: 4px; }
        .result-title { color: #1a0dab; text-decoration: none; font-size: 20px; display: block; margin-bottom: 3px; }
        .result-title:hover { text-decoration: underline; }
        .result-item .link { color: #006621; font-style: normal; font-size: 14px; }
        .result-item .snippet { color: #545454; font-size: 14px; line-height: 1.57; }
        .loader { text-align: center; padding: 20px; font-size: 16px; color: #777; }
        .result-item strong, .result-item b { font-weight: normal; background-color: #f1ee8e; padding: 1px 2px; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">
            <!-- Modified: Image is now loaded through our server proxy -->
            <img src="/proxy/resource?url=https%3A%2F%2Fwww.google.com%2Fimages%2Fbranding%2Fgooglelogo%2F2x%2Fgooglelogo_color_272x92dp.png" alt="Google Logo">
        </div>
        <div class="search-bar">
            <form id="search-form" style="width: 100%;"><input type="text" id="search-input" required></form>
        </div>
        <div class="buttons">
            <button type="submit" form="search-form">Google Search</button>
        </div>
        <div id="results"></div>
        <div id="loader-container"></div>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const searchForm = document.getElementById('search-form');
            const searchInput = document.getElementById('search-input');
            const resultsContainer = document.getElementById('results');
            const loaderContainer = document.getElementById('loader-container');

            // --- Configuration removed, API key is now on the server-side ---
            
            let currentQuery = '', startIndex = 1, isLoading = false, hasMoreResults = true;

            searchForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const query = searchInput.value.trim();
                if (query === '' || query === currentQuery) return;
                currentQuery = query;
                startIndex = 1;
                hasMoreResults = true;
                resultsContainer.innerHTML = '';
                await performSearch();
            });

            window.addEventListener('scroll', () => {
                if (isLoading || !hasMoreResults || !currentQuery) return;
                if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100) {
                    performSearch();
                }
            });

            async function performSearch() {
                if (isLoading || !hasMoreResults) return;
                isLoading = true;
                showLoader();

                // Modified: Request our own server's API endpoint
                const url = "/api/search?q=" + encodeURIComponent(currentQuery) + "&start=" + startIndex;

                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error("Server error! status: " + response.status);
                    const data = await response.json();
                    
                    if (data.error) throw new Error(data.error);
                    
                    if (!data.items || data.items.length === 0) {
                        hasMoreResults = false;
                        if (startIndex === 1) resultsContainer.innerHTML = '<p>No results found.</p>';
                        return;
                    }
                    
                    displayResults(data.items);
                    startIndex += 10;
                } catch (error) {
                    console.error('Error fetching search results:', error);
                    resultsContainer.innerHTML = "<p>Error: " + error.message + ". Please check the server console for details.</p>";
                } finally {
                    isLoading = false;
                    hideLoader();
                }
            }
            
            function highlightTerms(text, query) {
                if (!query) return text;
                const escapeRegex = (str) => str.replace(/[.*+?^$}{()|[\]\\]/g, '\\$&');
                const terms = query.split(/\s+/).filter(term => term.length > 0).map(escapeRegex);
                if (terms.length === 0) return text;
                const regex = new RegExp("(" + terms.join('|') + ")", 'gi');
                return text.replace(regex, '<strong>$&</strong>');
            }

            function displayResults(items) {
                if (!items) return;
                items.forEach(item => {
                    const resultItem = document.createElement('div');
                    resultItem.classList.add('result-item');
                    let hostname = item.displayLink;
                    try { hostname = new URL(item.link).hostname; } catch (e) {}
                    
                    // Modified: Favicon is also loaded through our proxy
                    const faviconGoogleUrl = "https://www.google.com/s2/favicons?domain=" + hostname + "&sz=16";
                    const faviconUrl = "/proxy/resource?url=" + encodeURIComponent(faviconGoogleUrl);

                    const sourceDiv = document.createElement('div');
                    sourceDiv.classList.add('result-source');
                    const faviconImg = document.createElement('img');
                    faviconImg.classList.add('favicon');
                    faviconImg.src = faviconUrl;
                    faviconImg.alt = 'favicon';
                    faviconImg.onerror = function() { this.style.display = 'none'; };
                    const linkSpan = document.createElement('span');
                    linkSpan.classList.add('link');
                    linkSpan.textContent = item.formattedUrl;
                    sourceDiv.appendChild(faviconImg);
                    sourceDiv.appendChild(linkSpan);

                    const titleLink = document.createElement('a');
                    titleLink.classList.add('result-title');
                    titleLink.href = item.link;
                    titleLink.target = '_blank';
                    titleLink.rel = 'noopener';
                    titleLink.innerHTML = highlightTerms(item.title, currentQuery);

                    const snippet = document.createElement('div');
                    snippet.classList.add('snippet');
                    snippet.innerHTML = item.htmlSnippet;

                    resultItem.appendChild(sourceDiv);
                    resultItem.appendChild(titleLink);
                    resultItem.appendChild(snippet);
                    resultsContainer.appendChild(resultItem);
                });
            }

            function showLoader() { loaderContainer.innerHTML = '<div class="loader">Loading more results...</div>'; }
            function hideLoader() { loaderContainer.innerHTML = ''; }
        });
    </script>
</body>
</html>
`;

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
  const parsedUrl = new URL("http://dummy.com" + req.url);
  console.log(parsedUrl);
  const pathname = parsedUrl.pathname;

  // Route 1: Root path, serves the HTML page
  if (pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(GOOGLE_SEARCH_HTML);
  }
  // Route 2: Search API proxy
  else if (pathname === "/api/search") {
    const query = parsedUrl.searchParams.get("q");
    const start = parsedUrl.searchParams.get("start") || "1";

    if (!query) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: 'Query parameter "q" is required' }));
      return;
    }

    const googleApiUrl = `https://www.googleapis.com/customsearch/v1?key=${SEARCH_API_KEY}&cx=${SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&start=${start}`;

    // Make a request to the Google API and pipe the response back to the client.
    https
      .get(googleApiUrl, (apiRes) => {
        res.writeHead(apiRes.statusCode, {
          "Content-Type": "application/json",
        });
        apiRes.pipe(res, { end: true });
      })
      .on("error", (e) => {
        console.error(`Got error: ${e.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch search results." }));
      });
  }
  // Route 3: Resource proxy (for images, favicons)
  else if (pathname === "/proxy/resource") {
    const resourceUrl = parsedUrl.searchParams.get("url");

    if (!resourceUrl) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("URL parameter is required");
      return;
    }

    try {
      const proxiedUrl = new URL(resourceUrl);

      // Request the resource and pipe it back to the client.
      https
        .get(proxiedUrl.href, (resourceRes) => {
          const contentType =
            resourceRes.headers["content-type"] || "application/octet-stream";
          res.writeHead(resourceRes.statusCode, {
            "Content-Type": contentType,
          });
          resourceRes.pipe(res, { end: true });
        })
        .on("error", (e) => {
          console.error(`Proxy error: ${e.message}`);
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Bad Gateway");
        });
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid URL");
    }
  }
  // Route 4: 404 Not Found for any other path
  else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

function handleRequest(req, res) {
  const host = req.headers.host || "";
  const url = new URL(req.url, `http://${host}`);
  const subdomain = host.split(".")[0];

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
