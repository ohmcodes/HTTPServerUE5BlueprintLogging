const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Create an Express app
const app = express();
// Use PORT from environment when available (container-friendly), default to 3006
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3006;

// In-memory log storage (for simplicity)
let logs = [];

// path to persist logs
const LOGS_FILE = path.join(__dirname, 'logs.json');

// directory to store archived log snapshots
const ARCHIVE_DIR = path.join(__dirname, 'archives');

// ensure archive directory exists
function ensureArchiveDir() {
	try {
		if (!fs.existsSync(ARCHIVE_DIR)) {
			fs.mkdirSync(ARCHIVE_DIR);
		}
	} catch (err) {
		console.error('Error ensuring archive directory:', err);
	}
}

// archive current logs to a dated file (returns filename or null)
function archiveLogs() {
	try {
		ensureArchiveDir();
		if (!logs || logs.length === 0) return null;
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const filename = `logs-${timestamp}.json`;
		const filepath = path.join(ARCHIVE_DIR, filename);
		fs.writeFileSync(filepath, JSON.stringify(logs, null, 2));
		return filename;
	} catch (err) {
		console.error('Error archiving logs:', err);
		return null;
	}
}

// load logs from disk (synchronous for simplicity)
function loadLogs() {
	try {
		if (fs.existsSync(LOGS_FILE)) {
			const data = fs.readFileSync(LOGS_FILE, 'utf8');
			logs = JSON.parse(data) || [];
		} else {
			logs = [];
			fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
		}
	} catch (err) {
		console.error('Error loading logs from disk:', err);
		logs = [];
	}
}

// save logs to disk (synchronous for simplicity)
function saveLogs() {
	try {
		fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
	} catch (err) {
		console.error('Error saving logs to disk:', err);
	}
}

// load existing logs at startup
loadLogs();

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static assets (CSS, images, client JS) under /static
app.use('/static', express.static(path.join(__dirname, 'public')));

// Mount UI router (separate file) to serve pages
try {
  const uiRouter = require(path.join(__dirname, 'routes', 'ui'));
  app.use('/', uiRouter);
} catch (e) {
  console.error('Failed to mount UI router:', e);
}

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// When a client connects via WebSocket
wss.on('connection', ws => {
    console.log('New WebSocket connection established');
    
  // mark connection alive for heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Send current logs to the client with an envelope so the client can distinguish message types
  try {
    ws.send(JSON.stringify({ type: 'init', data: logs }));
  } catch (err) {
    console.error('Failed to send initial logs to client:', err);
  }

  // When messages are received from clients (not used currently)
  ws.on('message', message => {
    console.log('Received from client:', message);
  });

  ws.on('error', err => {
    console.error('WebSocket error on connection:', err);
  });

  ws.on('close', (code, reason) => {
    // graceful close logging
    console.log('WebSocket connection closed', code, reason && reason.toString && reason.toString());
  });
});

// Add WebSocket upgrade support to the HTTP server
app.server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Handle WebSocket connection upgrade
app.server.on('upgrade', (request, socket, head) => {
  try {
    console.log('WebSocket upgrade request for', request.url, request.headers['sec-websocket-protocol'] || '');
    socket.on('error', err => console.error('Socket error during upgrade:', err));
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    console.error('Error handling upgrade:', err);
    try { socket.destroy(); } catch (e) {}
  }
});

// Heartbeat: terminate dead WebSocket connections
const HEARTBEAT_INTERVAL_MS = 30_000;
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    try {
      // only act on clients that are open
      if (ws.readyState !== WebSocket.OPEN) return;

      if (ws.isAlive === false) {
        console.warn('Terminating dead ws connection');
        return ws.terminate();
      }
      ws.isAlive = false;
      // ping only when open
      ws.ping(() => {});
    } catch (err) {
      console.error('Error during heartbeat ping:', err);
      try { ws.terminate(); } catch (e) {}
    }
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('error', err => {
  console.error('WebSocket server error:', err);
});

app.server.on('close', () => {
  clearInterval(heartbeatInterval);
});

// Route to receive logs via POST
app.post('/log', (req, res) => {
    const log = req.body.log;

    // Add the log to the in-memory logs array
    if (log) {
        logs.push(log);
        console.log("Received Log:", log);  // Optionally, print the log to the console

        // persist logs to disk
        saveLogs();

        // Broadcast the new log to all connected WebSocket clients
        wss.clients.forEach(client => {
          try {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'new', data: [log] }));
            }
          } catch (err) {
            console.error('Error sending new log to client:', err);
          }
        });

        // If the new log contains "shutdown" (case-insensitive), archive current logs and clear them
        try {
            if (typeof log === 'string' && /shutdown/i.test(log)) {
                const archived = archiveLogs(); // writes current logs (including this shutdown)
                logs = []; // clear in-memory logs
                saveLogs(); // persist cleared logs.json

                // notify WebSocket clients about the archive/clear event
                wss.clients.forEach(client => {
                    try {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'archive', data: { archived: archived || null, cleared: true } }));
                        }
                    } catch (err) {
                        console.error('Error notifying client of archive:', err);
                    }
                });

                return res.json({ message: 'Log received and archived (shutdown detected)', archived: archived });
              }
            } catch (err) {
              console.error('Error during auto-archive on shutdown:', err);
              // fallthrough to normal response if archive failed
            }

            res.send({ message: 'Log received' });
          } else {
            res.status(400).send({ error: 'No log provided' });
          }
        });

// Serve a basic HTML page to view logs
app.get('/logs', (req, res) => {
    // reload logs from disk before serving the page so refresh picks up saved logs
    loadLogs();
    res.sendFile(__dirname + '/logs.html');  // Serve an HTML file for the logs page
});

// new: serve a page that lists archived log snapshots
app.get('/logs/list', (req, res) => {
	res.sendFile(path.join(__dirname, 'logs_list.html'));
});

// API: return list of archived files (JSON)
app.get('/logs/archives', (req, res) => {
	try {
		ensureArchiveDir();
		const files = fs.readdirSync(ARCHIVE_DIR)
			.filter(f => f.endsWith('.json'))
			.sort()
			.reverse(); // newest first
		res.json(files);
	} catch (err) {
		console.error('Error listing archives:', err);
		res.status(500).json({ error: 'Unable to list archives' });
	}
});

// new: delete a specific archived file safely
app.delete('/logs/archives/:name', (req, res) => {
	try {
		const name = req.params.name;
		const safeName = path.basename(name);
		ensureArchiveDir();
		const dirResolved = path.resolve(ARCHIVE_DIR);
		const full = path.resolve(ARCHIVE_DIR, safeName);

		// ensure the resolved path is inside archive dir
		if (!full.startsWith(dirResolved + path.sep)) {
			return res.status(400).json({ error: 'Invalid filename' });
		}
		if (!fs.existsSync(full)) {
			return res.status(404).json({ error: 'File not found' });
		}

		fs.unlinkSync(full);
		return res.json({ ok: true, deleted: safeName });
	} catch (err) {
		console.error('Error deleting archive:', err);
		res.status(500).json({ error: 'Failed to delete archive' });
	}
});

// new: clear all archives (delete all files in archive dir)
app.post('/logs/archives/clear', (req, res) => {
	try {
		ensureArchiveDir();
		const files = fs.readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.json'));
		const deleted = [];
		for (const f of files) {
			try {
				fs.unlinkSync(path.join(ARCHIVE_DIR, f));
				deleted.push(f);
			} catch (e) {
				console.error('Failed to delete archive file', f, e);
			}
		}
		res.json({ ok: true, deleted });
	} catch (err) {
		console.error('Error clearing archives:', err);
		res.status(500).json({ error: 'Failed to clear archives' });
	}
});

// Optional: a small endpoint to fetch persisted logs as JSON
app.get('/logs/data', (req, res) => {
	loadLogs();
	res.json(logs);
});

// UI routes moved to `routes/ui.js` and served under '/'

// new: documentation page describing server capabilities and endpoints
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs.html'));
});

// Serve the documentation page (static HTML file)
app.get('/docs', (req, res) => {
	res.sendFile(path.join(__dirname, 'docs.html'));
});

// API: download a specific archived file safely (streaming, prevents path traversal)
app.get('/logs/download/:name', (req, res) => {
	try {
		const name = req.params.name || '';
		const safeName = path.basename(name); // strip any path parts
		ensureArchiveDir();
		const dirResolved = path.resolve(ARCHIVE_DIR);
		const full = path.resolve(ARCHIVE_DIR, safeName);

		// ensure the resolved path is inside archive dir
		const rel = path.relative(dirResolved, full);
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			return res.status(400).send('Invalid filename');
		}
		if (!fs.existsSync(full)) {
			return res.status(404).send('File not found');
		}

		// Stream file with attachment headers so browsers download it
		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
		const stream = fs.createReadStream(full);
		stream.on('error', err => {
			console.error('Error streaming file', full, err);
			if (!res.headersSent) res.status(500).send('Error reading file');
		});
		stream.pipe(res);
	} catch (err) {
		console.error('Error in download handler:', err);
		res.status(500).send('Server error');
	}
});
