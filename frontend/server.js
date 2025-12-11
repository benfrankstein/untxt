const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  // Redirect root to auth.html (login page)
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(302, { 'Location': '/auth.html' });
    res.end();
    return;
  }

  // Strip query parameters from URL (e.g., ?session_id=...)
  const urlWithoutQuery = req.url.split('?')[0];
  let filePath = urlWithoutQuery;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end('500 Internal Server Error');
      }
    } else {
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      };
      res.writeHead(200, headers);
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  UNTXT Frontend Server');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  URL:         http://localhost:${PORT}`);
  console.log(`  API:         http://localhost:8080`);
  console.log(`  WebSocket:   ws://localhost:8080`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Frontend server is ready!');
});
