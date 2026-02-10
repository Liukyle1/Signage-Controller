// main.cjs — Electron main process (CommonJS)
// Starts the Express server as a child process, then opens a BrowserWindow.

const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const PORT = 3000;
let serverProcess = null;
let mainWindow = null;

// ── Server lifecycle ───────────────────────────────────────────────

function startServer() {
  const serverPath = path.join(__dirname, "server.js");

  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PORT: String(PORT) },
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(d));
  serverProcess.stderr.on("data", (d) => process.stderr.write(d));

  serverProcess.on("error", (err) => {
    console.error("Failed to start server:", err.message);
  });

  serverProcess.on("exit", (code) => {
    console.log(`Server process exited with code ${code}`);
    serverProcess = null;
  });
}

function killServer() {
  if (!serverProcess) return;
  try {
    // On Windows, spawn taskkill to reliably end the child tree
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch { /* ignore */ }
  serverProcess = null;
}

// Poll localhost:PORT until the server responds (or give up after ~15 s).
function waitForServer(maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    function ping() {
      attempts++;
      const req = http.get(`http://localhost:${PORT}/api/pis`, (res) => {
        res.resume();           // consume response
        resolve();              // server is up
      });
      req.on("error", () => {
        if (attempts >= maxAttempts) {
          reject(new Error("Server did not start in time"));
        } else {
          setTimeout(ping, 500);
        }
      });
      req.end();
    }

    ping();
  });
}

// ── Window ─────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    title: "Signage Controller",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App events ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  startServer();

  try {
    await waitForServer();
  } catch (err) {
    console.error(err.message);
    // Continue anyway — user can refresh after server is ready
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // On macOS, apps stay open until Cmd+Q.  On Windows/Linux, quit.
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", killServer);
app.on("will-quit", killServer);
