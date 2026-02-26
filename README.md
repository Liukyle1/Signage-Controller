# Signage Controller

A desktop app for pushing MP4 videos to Raspberry Pi signage displays over your local network. Built with Electron and Express.

I built this to manage 4 Raspberry Pis that each loop a fullscreen video using VLC. Instead of SSHing into each one manually, this app lets you pick a video file, hit deploy, and it handles the upload + service restart automatically.

## How it works

1. You open the app and see a card for each Pi display
2. Pick an `.mp4` file for one or more displays
3. Hit **Deploy** — the app SCPs the file to the Pi, swaps it into place, and restarts the VLC service
4. The status badges update in real time so you know what succeeded

Under the hood, the Electron app spins up a local Express server that handles the file uploads and SSH commands. The frontend is a single HTML page that talks to the server via `fetch`.

## Deploy modes

- **Individual** — pick a file and deploy to one specific display
- **Batch** — assign a different video to each display and deploy them all at once
- **Legacy** — send the same video to every display in one shot (kept around for convenience)

## Pi setup

Each Pi needs:
- SSH key-based auth set up (no passwords)
- A directory at `/home/pi/videos/`
- VLC running as a systemd service (`signage-vlc.service`) that loops `/home/pi/videos/current.mp4`
- A sudoers rule so the `pi` user can restart the service without a password:
  ```
  pi ALL=(ALL) NOPASSWD: /bin/systemctl restart signage-vlc
  ```

Example VLC service file (`/etc/systemd/system/signage-vlc.service`):
```ini
[Unit]
Description=Signage VLC Player
After=graphical.target

[Service]
User=pi
Environment=DISPLAY=:0
ExecStart=/usr/bin/cvlc --fullscreen --loop /home/pi/videos/current.mp4
Restart=always

[Install]
WantedBy=graphical.target
```

## Configuration

All the Pi IPs, SSH settings, and upload limits are in `config.js`:

```js
export const PIS = [
  { id: "pi1", name: "Display 1", host: "192.168.100.10" },
  { id: "pi2", name: "Display 2", host: "192.168.100.11" },
  { id: "pi3", name: "Display 3", host: "192.168.100.12" },
  { id: "pi4", name: "Display 4", host: "192.168.100.13" },
];
```

Add or remove entries to match your setup. The UI builds itself from this list.

## Getting started

```bash
git clone https://github.com/Liukyle1/Signage-Controller.git
cd Signage-Controller
npm install
npm run dev
```

Make sure your machine has SSH/SCP available in PATH (Windows 10+ has OpenSSH built in).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Launches the Electron app |
| `npm run server` | Runs just the Express server (no Electron window) |
| `npm run dist` | Builds a distributable installer via electron-builder |

## Project structure

```
signage-controller/
  main.cjs          — electron main process, starts the server and opens the window
  server.js         — express backend, handles uploads and SSH deploys
  config.js         — Pi IPs, SSH flags, upload limits
  preload.js        — electron preload script (minimal)
  public/
    index.html      — the entire frontend UI
  uploads/          — temp directory for files mid-upload (auto-cleaned)
```

## Notes

- The app uploads files to a temp path (`.incoming.mp4`) first, then does an atomic `mv` to `current.mp4` so the VLC player doesn't try to read a half-written file
- Max upload size is 500 MB by default (configurable in `config.js`)
- The connectivity test just does an `ssh echo ok` to each Pi to check if it's reachable
- On Windows, the app uses `taskkill` to clean up the server process on quit since regular signals don't kill the child process tree
