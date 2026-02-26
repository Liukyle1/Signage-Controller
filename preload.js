// preload.js — bridges electron and the renderer
// keeps it minimal since the UI talks to the server via fetch

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("signage", {
  platform: process.platform,
});
