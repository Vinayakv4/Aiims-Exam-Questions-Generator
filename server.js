#!/usr/bin/env node
/**
 * AIIMS CRE 2026 — Start Server
 * This file serves the app AND proxies Replicate API calls.
 *
 * HOW TO START (pick one):
 *   • Double-click  "START.command"  in Finder
 *   • OR open Terminal and run:  node server.js
 *
 * Then open:  http://localhost:3000
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DIR  = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif' : 'image/gif',
  '.webp': 'image/webp',
  '.ico' : 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Allow all CORS (so the browser never blocks us)
const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age'      : '86400',
};

/* ────────────────────────────────────────────────────────
   Replicate Proxy  /replicate/* → https://api.replicate.com/*
   We strip /replicate prefix, everything else passes through.
──────────────────────────────────────────────────────── */
function proxyReplicate(req, res, replicatePath) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);

    const options = {
      hostname: 'api.replicate.com',
      port    : 443,
      path    : replicatePath,          // e.g. /v1/predictions
      method  : req.method,
      headers : {
        'Content-Type' : 'application/json',
      },
    };

    // Forward Authorization header if present
    if (req.headers['authorization']) {
      options.headers['Authorization'] = req.headers['authorization'];
    }
    if (bodyBuf.length > 0) {
      options.headers['Content-Length'] = bodyBuf.length;
    }

    console.log(`  ↗  PROXY ${req.method} https://api.replicate.com${replicatePath}`);

    const pReq = https.request(options, pRes => {
      const resBufs = [];
      pRes.on('data', c => resBufs.push(c));
      pRes.on('end', () => {
        const body = Buffer.concat(resBufs);
        console.log(`  ↙  ${pRes.statusCode} (${body.length} bytes)`);
        res.writeHead(pRes.statusCode, {
          'Content-Type': pRes.headers['content-type'] || 'application/json',
          ...CORS,
        });
        res.end(body);
      });
    });

    pReq.on('error', err => {
      console.error('  ✗  Proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ detail: 'Proxy error: ' + err.message }));
    });

    if (bodyBuf.length > 0) pReq.write(bodyBuf);
    pReq.end();
  });
}

/* ────────────────────────────────────────────────────────
   Gemini Proxy  /gemini/* → https://generativelanguage.googleapis.com/*
   We strip /gemini prefix, everything else passes through.
──────────────────────────────────────────────────────── */
function proxyGemini(req, res, geminiPath) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port    : 443,
      path    : geminiPath,
      method  : req.method,
      headers : {
        'Content-Type' : 'application/json',
      },
    };

    // Forward x-goog-api-key header if present
    if (req.headers['x-goog-api-key']) {
      options.headers['x-goog-api-key'] = req.headers['x-goog-api-key'];
    }
    if (bodyBuf.length > 0) {
      options.headers['Content-Length'] = bodyBuf.length;
    }

    console.log(`  ↗  PROXY ${req.method} https://generativelanguage.googleapis.com${geminiPath}`);

    const pReq = https.request(options, pRes => {
      const resBufs = [];
      pRes.on('data', c => resBufs.push(c));
      pRes.on('end', () => {
        const body = Buffer.concat(resBufs);
        console.log(`  ↙  ${pRes.statusCode} (${body.length} bytes)`);
        res.writeHead(pRes.statusCode, {
          'Content-Type': pRes.headers['content-type'] || 'application/json',
          ...CORS,
        });
        res.end(body);
      });
    });

    pReq.on('error', err => {
      console.error('  ✗  Gemini proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ detail: 'Gemini proxy error: ' + err.message }));
    });

    if (bodyBuf.length > 0) pReq.write(bodyBuf);
    pReq.end();
  });
}

/* ────────────────────────────────────────────────────────
   Static File Server
──────────────────────────────────────────────────────── */
function serveFile(req, res, pathname) {
    let filePath = path.join(DIR, pathname === '/' ? 'index.html' : pathname);

    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('File not found');
        } else {
          res.writeHead(500);
          res.end('Server error: ' + err.code);
        }
      } else {
        // AGGRESSIVE NO-CACHE HEADERS + Security headers
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Content-Length': content.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
        });
        res.end(content, 'utf-8');
      }
    });
}

/* ────────────────────────────────────────────────────────
   HTTP Server
──────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname  = parsedUrl.pathname;
  const fullPath  = pathname + parsedUrl.search; // preserve ?key=... etc.

  console.log(`  ${req.method} ${pathname}`);

  // CORS preflight — always respond 204
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // /replicate/* → https://api.replicate.com/*
  // e.g. /replicate/v1/predictions → /v1/predictions
  if (pathname.startsWith('/replicate/')) {
    proxyReplicate(req, res, fullPath.slice('/replicate'.length));
    return;
  }

  // /gemini/* → https://generativelanguage.googleapis.com/*
  if (pathname.startsWith('/gemini/')) {
    proxyGemini(req, res, fullPath.slice('/gemini'.length));
    return;
  }

  // Static files
  serveFile(req, res, pathname);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is busy. Run:  kill $(lsof -ti:${PORT})  then try again.\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`
╔══════════════════════════════════════════════════════╗
║   🏥  AIIMS CRE 2026 AI Exam Generator               ║
╠══════════════════════════════════════════════════════╣
║   ✅  Server: ${url}                      ║
║   ↗   Proxy:  /replicate/* → api.replicate.com       ║
║   ↗   Proxy:  /gemini/*    → generativelanguage API   ║
╚══════════════════════════════════════════════════════╝
`);

  // Auto-open browser locally only — skip on cloud hosts (no display, no env var to detect it reliably otherwise)
  if (!process.env.RENDER && !process.env.PORT) {
    try {
      const platform = process.platform;
      if      (platform === 'darwin') execSync(`open "${url}"`);
      else if (platform === 'win32')  execSync(`start "${url}"`);
      else                            execSync(`xdg-open "${url}"`);
      console.log('  🌐  Browser opened automatically.\n');
    } catch(_) {
      console.log(`  👆  Open this in your browser: ${url}\n`);
    }
  }

  console.log('  Press Ctrl+C to stop.\n');
});
