# HTTPServerUE5BlueprintLogging — Useful Shell Commands

This file collects the PowerShell (and cross-platform) commands used while developing and testing this project. Paste commands into your shell (PowerShell on Windows) and adapt paths or ports as needed.

Important: these commands were used with Windows PowerShell v5.1 in this workspace. When running several commands on a single line in PowerShell, use `;` to separate them. Where appropriate, a curl or sh/bash equivalent is provided for non-Windows systems.

---

## Start / Stop the server

- Start the server in the foreground (shows logs):

```powershell
node .\server.js
```

- Start the server detached (background):

```powershell
Start-Process -FilePath node -ArgumentList '.\server.js' -WindowStyle Hidden
```

- Find Node processes and stop those running `server.js` (stops any matching processes):

```powershell
#$: list processes with server.js in the command line
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server.js' }
$procs | Select-Object ProcessId, CommandLine
# stop them (careful — stops matching node processes)
$procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Notes:
- You can also stop a specific PID directly if you know it:

```powershell
Stop-Process -Id 36536 -Force
```

## Check networking / ports

- Check whether localhost:3006 is reachable (TCP test):

```powershell
Test-NetConnection -ComputerName localhost -Port 3006
```

- Show `netstat` lines containing `:3006` to find LISTEN/TIME_WAIT/ESTABLISHED:

```powershell
netstat -ano | Select-String ":3006"
```

- Show which process owns a TCP port (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 3006 | Select-Object LocalAddress,LocalPort,State,OwningProcess
Get-Process -Id <PID> | Select-Object Id, ProcessName, Path
```

## HTTP API tests (PowerShell)

- Post a single log entry (PowerShell):

```powershell
$body = @{ log = "Test log from PowerShell $(Get-Date)" }
Invoke-RestMethod -Uri http://localhost:3006/log -Method Post -Body (ConvertTo-Json $body) -ContentType 'application/json'
```

- Fetch persisted logs (JSON):

```powershell
Invoke-RestMethod -Uri http://localhost:3006/logs/data -Method Get
```

- Clear logs WITHOUT archiving (the button/endpoint used in the UI):

```powershell
Invoke-RestMethod -Uri http://localhost:3006/logs/clear-only -Method Post
```

- Archive current logs and clear them (server will save an archive file under `archives/`):

```powershell
Invoke-RestMethod -Uri http://localhost:3006/logs/clear -Method Post
```

- List archives (JSON):

```powershell
Invoke-RestMethod -Uri http://localhost:3006/logs/archives -Method Get
```

- Download a specific archive (PowerShell will stream the file to the console — use `-OutFile` with `Invoke-WebRequest` to save):

```powershell
Invoke-RestMethod -Uri http://localhost:3006/logs/download/<filename.json> -Method Get
# or to save to disk:
Invoke-WebRequest -Uri http://localhost:3006/logs/download/<filename.json> -OutFile .\downloaded-archive.json
```

## Posting many logs (bulk test)

- Post 1000 logs (PowerShell loop with a small delay to avoid overwhelming the server):

```powershell
for ($i=1; $i -le 1000; $i++) {
  $b = @{ log = "Automated test log #$i" }
  try { Invoke-RestMethod -Uri http://localhost:3006/log -Method Post -Body (ConvertTo-Json $b) -ContentType 'application/json' } catch { Write-Host "POST failed for $i" }
  Start-Sleep -Milliseconds 5
}
```

Notes:
- Adjust the `Start-Sleep` delay to throttle the rate. For faster bulk inserts use a Node script or async tool to parallelize safely.

## Inspect Node processes and command lines

- List all node.exe processes and their command lines (Windows):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine
```

## Troubleshooting WebSocket / Upgrade issues

- The server includes a guarded upgrade handler to avoid crashing on aborted upgrade handshakes (ECONNRESET). Useful net/debug commands:

```powershell
# watch netstat for websocket upgrades
netstat -ano | Select-String ":3006"
# tail server logs by running server foreground so you can observe upgrade logs
node .\server.js
```

## curl / bash equivalents (Linux / macOS)

- Post a single log using curl:

```bash
curl -X POST http://localhost:3006/log -H "Content-Type: application/json" -d '{"log":"Test log from curl"}'
```

- Post many logs in bash (simple loop):

```bash
for i in $(seq 1 1000); do
  curl -s -X POST http://localhost:3006/log -H "Content-Type: application/json" -d "{\"log\":\"Automated test log #$i\"}" &
  sleep 0.005
done
wait
```

## Helper: reset `logs.json` to empty array (force empty state)

If you want to zero out the logs file quickly (dangerous — irreversible unless you back up), run this from the project root:

```powershell
# overwrite logs.json with an empty array
Set-Content -Path .\logs.json -Value '[]' -Encoding UTF8
# then signal server (restart) or call GET /logs/data to reload
```

## Suggestions

- Add npm scripts to `package.json` for convenience, for example:

```json
"scripts": {
  "start": "node server.js",
  "start:bg": "Start-Process -FilePath node -ArgumentList 'server.js' -WindowStyle Hidden"
}
