// preload.js — Runs in the renderer before page scripts.
// contextIsolation is ON and nodeIntegration is OFF, so this is a safe bridge.
// Expose nothing for now — all communication goes through fetch() to the
// Express server running on localhost.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("signage", {
  platform: process.platform,
});
