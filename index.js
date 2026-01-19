const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const pm2 = require("pm2");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Free to change to any port, set to 4000 just for quick set up
const PORT = 4000;
// Tells Node to allow any connection point if you're using multiple IP's on one device like Tailscale
const HOST = "0.0.0.0";
// Change NULL to the application name of the pm2 instance running your bot
const BOT_NAME = "NULL";

// Global path for the bot folder so the terminal and register script know where to look, change NULL to your bots path
const BOT_FOLDER = path.resolve(__dirname, "NULL");

const logHistory = [];
const MAX_HISTORY = 100;

// --- UNIVERSAL PERSISTENT SHELL SETUP ---
// We detect the system's default shell (bash/zsh/sh). if none found, we default to 'sh'.
const systemShell = process.env.SHELL || "sh";

const shell = spawn(systemShell, [], {
  env: { ...process.env, TERM: "dumb" },
  shell: true,
  cwd: BOT_FOLDER,
});

// Listen for responses from manual commands sent to the shell
shell.stdout.on("data", (data) => {
  const msg = data.toString().trim();
  if (!msg) return;

  // Universal check for the path update tag
  if (msg.includes("PWD_UPDATE:")) {
    const parts = msg.split("PWD_UPDATE:");
    if (parts[0].trim()) {
      io.emit("pm2-log", addToHistory("SYSTEM", parts[0].trim()));
    }
    io.emit("path-update", parts[1].trim());
  } else {
    // Normal command output is tagged as SYSTEM (Blue)
    io.emit("pm2-log", addToHistory("SYSTEM", msg));
  }
});

// Capture shell-level errors
shell.stderr.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg) io.emit("pm2-log", addToHistory("STDERR", msg));
});

function addToHistory(type, msg) {
  const logEntry = {
    type: type,
    msg: msg,
    time: new Date().toLocaleTimeString(),
  };
  logHistory.push(logEntry);
  if (logHistory.length > MAX_HISTORY) logHistory.shift();
  return logEntry;
}

app.use(express.static(path.join(__dirname, "public")));

/* For a tab favicon (tab icon) */
app.get("/favicon.png", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.png"), (err) => {
    if (err) {
      console.error("Favicon file not found on disk!");
      res.status(404).end();
    }
  });
});

// Control endpoint for Start/Stop/Restart and custom CmdReload
app.post("/control/:action", (req, res) => {
  const action = req.params.action;

  if (action === "register") {
    const dotEnvPath = path.join(
      BOT_FOLDER,
      "node_modules",
      "dotenv",
      "config.js"
    );
    const scriptPath = path.join(BOT_FOLDER, "register.js");

    // Command structured to be compatible with sh, bash, and zsh
    const command = `node -r "${dotEnvPath}" "${scriptPath}"`;

    shell.stdin.write(command + ' ; echo "PWD_UPDATE:$(pwd)"\n');
    return res.send({ success: true });
  }

  pm2[action](BOT_NAME, (err) => {
    if (err) return res.status(500).send({ success: false, error: err });
    res.send({ success: true });
  });
});

// PM2 metadata for status and uptime
app.get("/meta", (req, res) => {
  pm2.describe(BOT_NAME, (err, desc) => {
    if (err || !desc.length) return res.json({ uptime: 0, status: "offline" });
    res.json({
      uptime: desc[0].pm2_env.pm_uptime,
      status: desc[0].pm2_env.status,
    });
  });
});

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <title>ElliBot Monitor</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <style>
            body { background: #121212; color: rgb(136, 0, 171); font-family: 'Courier New', monospace; padding: 20px; margin: 0; }
            .header-info { display: flex; justify-content: space-between; align-items: center; }
            #terminal-container { position: relative; background: #000; border: 1px solid #333; margin-top: 10px; }
            #terminal { height: 65vh; overflow-y: scroll; padding: 10px; font-size: 14px; }
            .terminal-input-area { display: flex; background: #111; border-top: 1px solid #333; padding: 5px; align-items: center; }
            #path-display { color: #666; font-size: 12px; padding: 0 10px; white-space: nowrap; font-weight: bold; }
            .prompt-char { color: #00FF41; padding-right: 5px; }
            #cmdInput { background: transparent; border: none; color: #fff; flex: 1; font-family: inherit; font-size: 14px; outline: none; }
            
            .controls { margin-bottom: 10px; display: flex; gap: 10px; flex-wrap: wrap; }
            button { background: #222; color: #8800ab; border: 1px solid #8800ab; padding: 8px 15px; cursor: pointer; font-family: monospace; }
            button:hover { background: #8800ab; color: #fff; }
            .restart { border-color: #ffaa00; color: #ffaa00; }
            .stop { border-color: #ff4444; color: #ff4444; }
            .register { border-color: #00aaff; color: #00aaff; }
            #filterInput { background:#000; color:#8800ab; border:1px solid #333; padding:5px; outline:none; }
        </style>
    </head>
    <body>
        <div class="header-info">
            <h2>System Monitor: ${BOT_NAME}</h2>
            <div id="stats" style="color:#666; font-size:0.9em;">Status: <span id="stat-s">--</span> | Uptime: <span id="stat-u">0s</span></div>
        </div>

        <div class="controls">
            <button onclick="sendControl('start')">▶ START</button>
            <button class="restart" onclick="sendControl('restart')">🔄 RESTART</button>
            <button class="stop" onclick="sendControl('stop')">🛑 STOP</button>
            <button class="register" onclick="sendControl('register')">⚡ CmdReload</button>
            <button onclick="terminal.innerHTML=''">🗑️ CLEAR VIEW</button>
            <input type="text" id="filterInput" placeholder="Filter logs...">
        </div>

        <div id="terminal-container">
            <div id="terminal"><div>-- Reading Terminal And ${BOT_NAME} PM2 Logs... --</div></div>
            <div class="terminal-input-area">
                <div id="path-display">~</div>
                <span class="prompt-char">&gt;</span>
                <input type="text" id="cmdInput" placeholder="Enter manual command..." autocomplete="off">
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const terminal = document.getElementById('terminal');
            const cmdInput = document.getElementById('cmdInput');
            const pathDisplay = document.getElementById('path-display');
            const filterInput = document.getElementById('filterInput');

            async function sendControl(action) {
                if(!confirm('Are you sure you want to ' + action + ' the bot?')) return;
                await fetch('/control/' + action, { method: 'POST' });
            }

            // Real-time log filter logic
            filterInput.addEventListener('input', () => {
                const query = filterInput.value.toLowerCase();
                const logs = terminal.querySelectorAll('div');
                logs.forEach(log => {
                    log.style.display = log.textContent.toLowerCase().includes(query) ? 'block' : 'none';
                });
            });

            // Handle manual command entry
            cmdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && cmdInput.value.trim() !== '') {
                    const cmd = cmdInput.value;
                    appendLog({ time: new Date().toLocaleTimeString(), type: 'USER', msg: cmd });
                    socket.emit('manual-command', cmd); 
                    cmdInput.value = '';
                }
            });

            function appendLog(data) {
                const line = document.createElement('div');
                line.style.borderBottom = "1px solid #111";
                line.style.padding = "2px 0";

                if(data.type === 'STDERR') line.style.color = '#ff5555';
                else if(data.type === 'SYSTEM') line.style.color = '#00aaff';
                else if(data.type === 'USER') line.style.color = '#00FF41';
                else line.style.color = 'rgb(136, 0, 171)';

                line.textContent = \`[\${data.time}] [\${data.type}]: \${data.msg}\`;

                const query = filterInput.value.toLowerCase();
                if (query && !line.textContent.toLowerCase().includes(query)) line.style.display = 'none';

                terminal.appendChild(line);
                terminal.scrollTop = terminal.scrollHeight;
            }

            socket.on('path-update', (newPath) => {
                pathDisplay.textContent = newPath.split('/').pop() || '/';
            });

            socket.on('pm2-log', appendLog);
            socket.on('log-history', (h) => h.forEach(appendLog));

            function updateMeta() {
                fetch('/meta').then(r => r.json()).then(data => {
                    document.getElementById('stat-s').textContent = data.status.toUpperCase();
                    if(data.uptime > 0) {
                        const seconds = Math.floor((Date.now() - data.uptime) / 1000);
                        const h = Math.floor(seconds / 3600);
                        const m = Math.floor((seconds % 3600) / 60);
                        const s = seconds % 60;
                        document.getElementById('stat-u').textContent = \`\${h}h \${m}m \${s}s\`;
                    } else {
                        document.getElementById('stat-u').textContent = '0s';
                    }
                });
            }
            setInterval(updateMeta, 2000);
            socket.on('connect', () => socket.emit('manual-command', 'pwd'));
        </script>

        <br/>
        <br/>
        <br/>
        <br/>

        <footer> &#169; Exator911 2026 </footer>
    </body>
    </html>
  `);
});

pm2.connect((err) => {
  if (err) {
    console.error("Could not connect to PM2", err);
    process.exit(2);
  }

  pm2.launchBus((err, bus) => {
    bus.on("log:out", (data) => {
      if (data.process.name === BOT_NAME)
        io.emit("pm2-log", addToHistory("STDOUT", data.data));
    });
    bus.on("log:err", (data) => {
      if (data.process.name === BOT_NAME)
        io.emit("pm2-log", addToHistory("STDERR", data.data));
    });
  });
});

io.on("connection", (socket) => {
  socket.emit("log-history", logHistory);

  socket.on("manual-command", (cmd) => {
    addToHistory("USER", cmd);
    // Universal command execution: Run the command, then print the directory
    shell.stdin.write(cmd + ' ; echo "PWD_UPDATE:$(pwd)"\n');
  });
});

/* This part is made specificaly for MacOS systems or systems with network polices that tell the device to stop 
inboud and outbound connects for the website page, if you expirience this issue on MacOS or other similar systems 
there are some system polices you will need to change to ensure this works properly but it helps keep the website 
alive. [This is primarly for laptop use cases or just heavily restricted systems || This is safe to remove if you want]
*/
setInterval(() => {
  require('https').get('https://example.com', () => {});
}, 30000);

/* This will print in the logs of the pm2 instance running this script, you can either type it manually into your 
browser or view the logs and quick link to it. Or again if your using multiple IP's like a Tailscale IP you can
use that IP address and just put the port this script is running at
*/
server.listen(PORT, HOST, () =>
  console.log(`Monitor online: http://0.0.0.0:${PORT}`)
);
