import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("installer", {
    defaults: () => ipcRenderer.invoke("defaults") as Promise<{ defaultHost: string; hubUrl: string; }>,
    apply: (host: string) => ipcRenderer.invoke("apply", host) as Promise<{ ok: boolean; domain: string; transport: string; }>,
    openHub: () => ipcRenderer.invoke("open-hub"),
});
