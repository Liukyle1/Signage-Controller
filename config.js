// config.js — Central configuration for the Signage Controller

export const PIS = [
  { id: "pi1", name: "Display 1", host: "192.168.100.10" },
  { id: "pi2", name: "Display 2", host: "192.168.100.11" },
  { id: "pi3", name: "Display 3", host: "192.168.100.12" },
  { id: "pi4", name: "Display 4", host: "192.168.100.13" },
];

export const PI_USER = "pi";

export const REMOTE_DIR      = "/home/pi/videos";
export const REMOTE_INCOMING = `${REMOTE_DIR}/.incoming.mp4`;
export const REMOTE_CURRENT  = `${REMOTE_DIR}/current.mp4`;

export const PORT = 3000;

// Max upload size in bytes (500 MB)
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

// SSH / SCP options to skip host-key prompts
export const SSH_OPTS = [
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "ConnectTimeout=10",
];
