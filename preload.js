// preload — just exposes the platform for now, everything else goes through fetch

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("signage", {
  platform: process.platform,
});
