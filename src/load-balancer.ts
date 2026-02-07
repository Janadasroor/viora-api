import http from 'http';
import httpProxy from 'http-proxy';
import dotenv from 'dotenv';

dotenv.config();

const PORT = 8083;

// List of backend servers
const servers = [
    { host: 'localhost', port: 3001 },
    { host: 'localhost', port: 3002 },
    { host: 'localhost', port: 3003 }
];

let current = 0;

const proxy = httpProxy.createProxyServer({});

// Handle proxy errors to prevent crash
proxy.on('error', (err: any, req: any, res: any) => {
    console.error('Proxy Error:', err);
    if (res && res.writeHead && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
    }
});

const server = http.createServer((req, res) => {
    // Round-robin selection
    const target = servers[current];
    current = (current + 1) % servers.length;

    if (target) {
        // Forward request
        proxy.web(req, res, { target: `http://${target.host}:${target.port}` });
    } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error: No backend servers available');
    }
});

server.listen(PORT);
