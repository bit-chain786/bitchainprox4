const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  // If URL has %23 (encoded #), redirect to proper hash
  if (req.url.includes('%23')) {
    const fixedUrl = req.url.replace(/%23/g, '#');
    res.writeHead(302, { 'Location': fixedUrl });
    return res.end();
  }

  // Parse clean URL (strip query, hash, or %23)
  let parsedUrl = req.url.split('?')[0].split('#')[0].split('%23')[0];
  if (parsedUrl === '/') {
    parsedUrl = '/index.html';
  } else if (!path.extname(parsedUrl)) {
    // If no extension, check if .html exists (cleanUrls support)
    if (fs.existsSync(path.join(ROOT, parsedUrl + '.html'))) {
      parsedUrl = parsedUrl + '.html';
    }
  }

  const filePath = path.join(ROOT, parsedUrl);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Access Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<h2>404 Not Found</h2><p>Page <code>${parsedUrl}</code> does not exist.</p><p><a href="/">Return Home</a></p>`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Prevent caching in dev preview
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Preview server running at: http://localhost:${PORT}/\n`);
});
