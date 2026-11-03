'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const tls = require('node:tls');
const { startSyntheticProxy } = require('./synthetic-proxy.cjs');

test('synthetic HTTPS transport serves dynamic fixtures and denies unknown hosts, ports, paths and methods', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qw-transport-test-'));
  let transport, value = 18;
  t.after(async () => { await transport?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  transport = await startSyntheticProxy({ directory, fixture: url => url === '/codex/settings/usage' ? `<p>${value}% remaining</p>` : null });
  async function probe(authority, requestPath = '/codex/settings/usage', method = 'GET', host = 'chatgpt.com') {
    const address = new URL(transport.url);
    return new Promise((resolve, reject) => {
      // Even denial probes connect to loopback, never the requested authority.
      const request = http.request({ host: address.hostname, port: address.port, method: 'CONNECT', path: authority });
      request.setTimeout(5000, () => request.destroy(new Error('CONNECT timeout')));
      request.on('error', reject);
      request.on('connect', (response, socket) => {
        if (response.statusCode !== 200) { socket.destroy(); resolve({ status: response.statusCode }); return; }
        const secure = tls.connect({ socket, servername: 'chatgpt.com', rejectUnauthorized: false });
        secure.setTimeout(5000, () => secure.destroy(new Error('TLS fixture timeout')));
        secure.on('error', reject);
        secure.on('secureConnect', () => secure.write(`${method} ${requestPath} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
        let text = '';
        secure.on('data', chunk => { text += chunk; });
        secure.on('end', () => resolve({ status: Number(text.match(/^HTTP\/1\.1 (\d+)/)?.[1]), body: text.split('\r\n\r\n').slice(1).join('\r\n\r\n') }));
      });
      request.end();
    });
  }
  assert.deepEqual(await probe('chatgpt.com:443'), { status: 200, body: '<p>18% remaining</p>' });
  value = 27;
  assert.deepEqual(await probe('chatgpt.com:443'), { status: 200, body: '<p>27% remaining</p>' });
  assert.equal((await probe('chatgpt.com:443', '/unexpected')).status, 403);
  assert.equal((await probe('chatgpt.com:443', '/codex/settings/usage?unexpected=1')).status, 403);
  assert.equal((await probe('chatgpt.com:443', '/codex/settings/usage', 'POST')).status, 403);
  assert.equal((await probe('chatgpt.com:443', '/codex/settings/usage', 'GET', 'example.invalid')).status, 403);
  assert.equal((await probe('example.invalid:443')).status, 403);
  assert.equal((await probe('chatgpt.com:8443')).status, 403);
  const plain = await new Promise((resolve, reject) => {
    const address = new URL(transport.url);
    const request = http.get({ host: address.hostname, port: address.port, path: 'http://example.invalid/' }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.setTimeout(5000, () => request.destroy(new Error('HTTP denial timeout')));
    request.on('error', reject);
  });
  assert.equal(plain, 403);
  assert.equal(transport.stats.fixtureResponses, 2);
  assert.equal(transport.stats.deniedRequests, 4);
  assert.equal(transport.stats.deniedConnections, 3);
});
