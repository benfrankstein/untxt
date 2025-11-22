const browserSync = require('browser-sync').create();

browserSync.init({
  server: {
    baseDir: './',
    middleware: function (req, res, next) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    }
  },
  port: 3000,
  files: [
    '*.html',
    '*.css',
    '*.js',
    '!node_modules/**',
    '!server.js',
    '!server-dev.js'
  ],
  notify: false,
  open: false,
  ui: false,
  logLevel: 'silent',
  callbacks: {
    ready: function(err, bs) {
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  UNTXT Frontend Server (Live Reload)');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  URL:         http://localhost:3000`);
      console.log(`  API:         http://localhost:8080`);
      console.log(`  WebSocket:   ws://localhost:8080`);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  Watching:    *.html, *.css, *.js');
      console.log('  Auto-reload: ENABLED ✓');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');
      console.log('Frontend server is ready with live reload!');
    }
  }
});
