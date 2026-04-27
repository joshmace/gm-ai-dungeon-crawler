// AI Dungeon Crawler Server
// Serves static files AND proxies API calls to Anthropic

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// CONFIGURATION
const PORT = process.env.PORT || 8000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-5';
// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // GET /api/config — system-level config (e.g. AI model) for client display
    if (req.method === 'GET' && req.url === '/api/config') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ model: AI_MODEL }));
        return;
    }

    // API proxy: POST /api/messages
    if (req.method === 'POST' && req.url === '/api/messages') {
        if (!ANTHROPIC_API_KEY) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Server misconfiguration: API key not set' }));
            return;
        }
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const requestData = JSON.parse(body);
                const wantStream = !!requestData.stream;

                const anthropicPayload = {
                    model: AI_MODEL || requestData.model || 'claude-sonnet-4-5',
                    max_tokens: requestData.max_tokens || 2000,
                    system: requestData.system,
                    messages: requestData.messages
                };
                if (wantStream) anthropicPayload.stream = true;
                const anthropicData = JSON.stringify(anthropicPayload);

                const options = {
                    hostname: 'api.anthropic.com',
                    port: 443,
                    path: '/v1/messages',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': ANTHROPIC_API_KEY,
                        'anthropic-version': '2023-06-01',
                        'Content-Length': Buffer.byteLength(anthropicData)
                    }
                };

                const anthropicReq = https.request(options, (anthropicRes) => {
                    if (wantStream && anthropicRes.statusCode < 400) {
                        // Pipe SSE through to client unchanged.
                        res.writeHead(anthropicRes.statusCode, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache, no-transform',
                            'Connection': 'keep-alive',
                            'X-Accel-Buffering': 'no'
                        });
                        anthropicRes.pipe(res);
                        anthropicRes.on('error', (err) => {
                            console.error('Stream error from Anthropic:', err);
                            try { res.end(); } catch (e) {}
                        });
                        return;
                    }

                    // Non-streaming (or upstream error): buffer and forward as JSON.
                    let responseData = '';
                    anthropicRes.on('data', chunk => { responseData += chunk; });
                    anthropicRes.on('end', () => {
                        if (anthropicRes.statusCode >= 400) {
                            const reqSize = Buffer.byteLength(anthropicData, 'utf8');
                            console.error('Anthropic API error', anthropicRes.statusCode, '| Request size:', reqSize, 'bytes');
                            try {
                                const errBody = JSON.parse(responseData);
                                console.error('Anthropic response:', JSON.stringify(errBody, null, 2));
                            } catch (e) {
                                console.error('Anthropic response (raw):', responseData.slice(0, 500));
                            }
                        }
                        res.writeHead(anthropicRes.statusCode, {
                            'Content-Type': 'application/json'
                        });
                        res.end(responseData);
                    });
                });

                anthropicReq.on('error', (error) => {
                    console.error('Error calling Anthropic API:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to call Anthropic API' }));
                });

                anthropicReq.write(anthropicData);
                anthropicReq.end();

            } catch (error) {
                console.error('Error parsing request:', error.message);
                if (body && body.length > 0) {
                    const preview = body.length > 500 ? body.slice(0, 250) + '...[truncated]...' + body.slice(-250) : body;
                    console.error('Body length:', body.length, 'Preview:', preview);
                }
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request', detail: error.message }));
            }
        });
        return;
    }

    // Static file serving: GET requests
    if (req.method === 'GET') {
        let filePath = req.url === '/' ? '/index.html' : req.url;

        // Strip query strings
        filePath = filePath.split('?')[0];

        // Prevent directory traversal
        filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.join(__dirname, filePath);

        const ext = path.extname(fullPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(fullPath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
        return;
    }

    // Fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    if (!ANTHROPIC_API_KEY) {
        console.error('ERROR: ANTHROPIC_API_KEY environment variable is not set. Set it before starting.');
    }
    console.log(`AI Dungeon Crawler server running on port ${PORT}`);
});
