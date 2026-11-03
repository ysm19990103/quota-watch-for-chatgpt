/* Local HTTPS fixture transport. This proxy has no code path to an external server. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');

async function startSyntheticProxy({ directory, fixture }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(directory, 'synthetic-key.pem');
  const certPath = path.join(directory, 'synthetic-cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=chatgpt.com',
    '-addext', 'subjectAltName=DNS:chatgpt.com'], { encoding: 'utf8', timeout: 15000 });
  if (generated.status !== 0) throw new Error(`Synthetic certificate generation failed: ${generated.error?.message || generated.stderr}`);
  fs.chmodSync(keyPath, 0o600);
  const sockets = new Set();
  const stats = { syntheticTunnels: 0, deniedConnections: 0, deniedRequests: 0, fixtureResponses: 0 };
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  const deny = response => { response.writeHead(403, { 'Cache-Control': 'no-store' }); response.end('Synthetic test: network denied'); };
  const fixtureServer = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), ALPNProtocols: ['http/1.1'] }, (request, response) => {
    // Check both authority and exact path; unknown methods/routes are never forwarded.
    const body = request.method === 'GET' && /^chatgpt\.com(?::443)?$/i.test(request.headers.host || '') ? fixture(request.url) : null;
    if (typeof body !== 'string') { stats.deniedRequests++; deny(response); return; }
    stats.fixtureResponses++;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    response.end(body);
  });
  fixtureServer.on('connection', track);
  fixtureServer.on('tlsClientError', () => {});
  fixtureServer.listen(0, '127.0.0.1');
  await once(fixtureServer, 'listening');
  const proxy = http.createServer((_request, response) => { stats.deniedConnections++; deny(response); });
  proxy.on('connection', track);
  proxy.on('connect', (request, client, head) => {
    if (request.url.toLowerCase() !== 'chatgpt.com:443') {
      stats.deniedConnections++;
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    // Fixed numeric loopback address and the server's own ephemeral port only.
    // The requested hostname is never used for DNS or an outbound connection.
    const local = track(net.connect({ host: '127.0.0.1', port: fixtureServer.address().port }));
    local.once('connect', () => {
      stats.syntheticTunnels++;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) local.write(head);
      client.pipe(local); local.pipe(client);
    });
    local.on('error', () => client.destroy());
    client.on('error', () => local.destroy());
    client.on('close', () => local.destroy());
    local.on('close', () => client.destroy());
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  return {
    url: `http://127.0.0.1:${proxy.address().port}`,
    stats,
    async close() {
      const closed = [new Promise(resolve => proxy.close(resolve)), new Promise(resolve => fixtureServer.close(resolve))];
      for (const socket of sockets) socket.destroy();
      await Promise.all(closed);
    },
  };
}
module.exports = { startSyntheticProxy };

