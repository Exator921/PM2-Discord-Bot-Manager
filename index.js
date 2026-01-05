const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const pm2 = require("pm2");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

//Free to change to any port, set to 4000 just for quick set up
const PORT = 4000;
//Tells Node to allow any connection point if your using multiple IP's on one device like Tailscale
const HOST = "0.0.0.0";
//Change NULL to the application name of the pm2 instance running your bot
const BOT_NAME = "NULL";

const logHistory = [];
const MAX_HISTORY = 100;

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

/* For a tab favicon (tab icon) | [This is optional to do but you need to at least make a public folder.. 
probably, i don't fully know lol] */
app.get("/favicon.png", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "favicon.png"), (err) => {
    if (err) {
      console.error("Favicon file not found on disk!");
      res.status(404).end();
    }
  });
});

app.post("/control/:action", (req, res) => {
  const action = req.params.action;
  pm2[action](BOT_NAME, (err) => {
    if (err) return res.status(500).send({ success: false, error: err });
    res.send({ success: true });
  });
});

/* The text color by default is set to purple but this can be changed if you want. If your in VSCode or something
that gives you color icons next to the color values you easily see what you need to change. 
*/
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <html>
        <head>
            
            <title>${BOT_NAME} Monitor</title>
            <link rel="icon" type="image/png" href="/favicon.png" />
            <style>
                body { background: #121212; color: rgb(136, 0, 171); font-family: 'Courier New', monospace; padding: 20px; }
                #terminal { background: #000; border: 1px solid #333; padding: 10px; height: 70vh; overflow-y: scroll; font-size: 14px; margin-top: 10px; }
                .controls { margin-bottom: 10px; display: flex; gap: 10px; }
                button { background: #222; color: #8800ab; border: 1px solid #8800ab; padding: 8px 15px; cursor: pointer; font-family: monospace; }
                button:hover { background: #8800ab; color: #fff; }
                button:active { transform: translateY(2px); }
                .restart { border-color: #ffaa00; color: #ffaa00; }
                .stop { border-color: #ff4444; color: #ff4444; }
            </style>
        </head>
        <body style="background: #121212; color:rgb(136, 0, 171); font-family: 'Courier New', monospace; padding: 20px;">
            <h2>System Monitor: ${BOT_NAME}</h2>

            <div class="controls">
                <button onclick="sendControl('start')">▶ START</button>
                <button class="restart" onclick="sendControl('restart')">🔄 RESTART</button>
                <button class="stop" onclick="sendControl('stop')">🛑 STOP</button>
                <button onclick="document.getElementById('terminal').innerHTML=''">🗑️ CLEAR VIEW</button>
            </div>

            <div id="terminal" style="background: #000; border: 1px solid #333; padding: 10px; height: 80vh; overflow-y: scroll; font-size: 14px;">
                <div>-- Connected To ${BOT_NAME} PM2 Logs. Awaiting logs...--</div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                const terminal = document.getElementById('terminal');

                async function sendControl(action) {
                    if(!confirm('Are you sure you want to ' + action + ' the bot?')) return;
                    await fetch('/control/' + action, { method: 'POST' });
                }

                function appendLog(data) {
                    const line = document.createElement('div');
                    line.style.borderBottom = "1px solid #111";
                    line.style.padding = "2px 0";
                    line.style.color = data.type === 'STDERR' ? '#ff5555' : 'rgb(136, 0, 171)';
                    line.textContent = \`[\${data.time}] [\${data.type}]: \${data.msg}\`;
                    terminal.appendChild(line);
                    terminal.scrollTop = terminal.scrollHeight;
                }

                // Handle the batch of old logs
                socket.on('log-history', (history) => {
                    history.forEach(log => appendLog(log));
                });

                // Handle new live logs
                socket.on('pm2-log', (data) => {
                    appendLog(data);
                    if(terminal.childNodes.length > 200) terminal.removeChild(terminal.firstChild);
                });
            </script>
        </body>
    </html>
  `);
});

io.on("connection", (socket) => {
  socket.emit("log-history", logHistory);
});

pm2.connect((err) => {
  if (err) {
    console.error("Could not connect to PM2", err);
    process.exit(2);
  }

  pm2.launchBus((err, bus) => {
    bus.on("log:out", (data) => {
      if (data.process.name === BOT_NAME) {
        const entry = addToHistory("STDOUT", data.data);
        io.emit("pm2-log", entry);
      }
    });

    bus.on("log:err", (data) => {
      if (data.process.name === BOT_NAME) {
        const entry = addToHistory("STDERR", data.data);
        io.emit("pm2-log", entry);
      }
    });
  });
});

/* This will print in the logs of the pm2 instance running this script, you can either type it manually into your 
browser or view the logs and quick link to it. Or again if your using multiple IP's like a Tailscale IP you can
use that IP address and just put the port this script is running at
*/
server.listen(PORT, HOST, () => {
  console.log(`Monitor running at http://0.0.0.0:${PORT}`);
});
