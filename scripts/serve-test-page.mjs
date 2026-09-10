import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixture = resolve(import.meta.dirname, '../extension/test-course.html');
const port = Number(process.env.PORT || 4177);
const html = await readFile(fixture);
const server = createServer((request, response) => {
  if (request.url === '/' || request.url === '/test-course.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Chrome test course: http://127.0.0.1:${port}/test-course.html`);
  console.log('Keep this process running while you test the extension. Press Ctrl-C to stop.');
});
