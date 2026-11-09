// Electron shell: starts the Python scan server (bundled exe when packaged, python in dev),
// waits for its READY line, then shows the UI in an app window. Closing the window stops the server.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

let server = null;

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function startServer(port) {
  const args = ['--port', String(port), '--data', app.getPath('userData'), '--no-browser'];
  const opts = { windowsHide: true };
  server = app.isPackaged
    ? spawn(path.join(process.resourcesPath, 'server', 'fm-supa-scout-server.exe'), args, opts)
    : spawn('python', [path.join(__dirname, '..', 'server', 'server.py'), ...args], opts);
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    const timer = setTimeout(() => reject(new Error('The scan server did not start within 60 seconds.')), 60000);
    server.stdout.on('data', d => { out += d; if (/READY \d+/.test(out)) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', d => { err = (err + d).slice(-2000); });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`The scan server stopped (code ${code}).\n\n${err}`)); });
  });
}

function stopServer() {
  if (server && server.exitCode === null) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0e2418', autoHideMenuBar: true, title: 'FM Supa Scout', show: false,
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  try {
    const port = await freePort();
    await startServer(port);
    await win.loadURL(`http://127.0.0.1:${port}`);
  } catch (e) {
    dialog.showErrorBox('FM Supa Scout could not start', e.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', stopServer);
