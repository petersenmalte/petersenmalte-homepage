import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const prefix = '/petersenmalte-homepage/';
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  // Match GitHub Pages project hosting: domain-root links must fail these tests.
  if (!pathname.startsWith(prefix)) {
    response.writeHead(404).end('Not found');
    return;
  }
  const relative = pathname.slice(prefix.length) || 'index.html';
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(4173, '127.0.0.1');
