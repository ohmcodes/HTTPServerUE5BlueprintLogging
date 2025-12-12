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

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

// When a client connects via WebSocket
wss.on('connection', ws => {
    console.log('New WebSocket connection established');
    
    // Send current logs to the client
    ws.send(JSON.stringify(logs));

    // When new logs are received, send them to the connected client
    ws.on('message', message => {
        console.log('Received from client:', message);
    });
});

// Add WebSocket upgrade support to the HTTP server
app.server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Handle WebSocket connection upgrade
app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
    });
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
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify([log]));
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
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ archived: archived || null, cleared: true }));
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

// updated root page: added link to /docs in nav
app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Log Server — Home</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; }
  header { display:flex; gap:12px; align-items:center; margin-bottom:16px; }
  nav a { margin-right:8px; text-decoration:none; color:#0366d6; }
  button { margin-left:6px; }
  #archives { margin-top:18px; }
  li { margin:6px 0; }
</style>
</head>
<body>
  <header>
    <h2 style="margin:0 12px 0 0">HTTP Log Server</h2>
    <nav>
      <a href="/logs" target="_blank">Live Logs</a>
      <a href="/logs/list" target="_blank">Archived Logs (page)</a>
      <a href="/logs/archives" target="_blank">Archives (JSON)</a>
      <a href="/logs/data" target="_blank">Current Logs (JSON)</a>
      <a href="/docs" target="_blank">Docs</a>
    </nav>
    <div>
      <button id="clearCurrent">Archive & Clear Current Logs</button>
      <button id="clearArchives">Delete All Archives</button>
      <button id="refresh">Refresh List</button>
    </div>
  </header>

  <section>
    <h3>Recent Archives</h3>
    <ul id="archives">Loading…</ul>
  </section>

  <script>
    async function loadArchives() {
      const ul = document.getElementById('archives');
      ul.innerHTML = 'Loading…';
      try {
        const res = await fetch('/logs/archives');
        if (!res.ok) throw new Error('Failed to fetch');
        const files = await res.json();
        if (!files.length) { ul.innerHTML = '<li>(no archives)</li>'; return; }
        ul.innerHTML = '';
        for (const f of files) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = '/logs/download/' + encodeURIComponent(f);
          a.innerText = f;
          a.target = '_blank';
          li.appendChild(a);

          const del = document.createElement('button');
          del.innerText = 'Delete';
          del.style.marginLeft = '8px';
          del.addEventListener('click', async () => {
            if (!confirm('Delete archive ' + f + '?')) return;
            const dres = await fetch('/logs/archives/' + encodeURIComponent(f), { method: 'DELETE' });
            if (dres.ok) loadArchives(); else alert('Delete failed');
          });
          li.appendChild(del);

          ul.appendChild(li);
        }
      } catch (e) {
        ul.innerHTML = '<li>Error loading archives</li>';
      }
    }

    document.getElementById('refresh').addEventListener('click', loadArchives);

    document.getElementById('clearCurrent').addEventListener('click', async () => {
      if (!confirm('Archive current logs and clear them?')) return;
      const res = await fetch('/logs/clear', { method: 'POST' });
      if (!res.ok) { alert('Failed to clear current logs'); return; }
      const body = await res.json();
      alert('Cleared current logs. Archive: ' + (body.archived || '(none)'));
      loadArchives();
    });

    document.getElementById('clearArchives').addEventListener('click', async () => {
      if (!confirm('Delete all archived log files?')) return;
      const res = await fetch('/logs/archives/clear', { method: 'POST' });
      if (!res.ok) { alert('Failed to clear archives'); return; }
      const body = await res.json();
      alert('Deleted ' + (body.deleted ? body.deleted.length : 0) + ' archive(s).');
      loadArchives();
    });

    // initial load
    loadArchives();
  </script>
</body>
</html>`);
});

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
