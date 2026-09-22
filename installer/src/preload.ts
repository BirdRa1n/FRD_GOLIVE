import { contextBridge, ipcRenderer } from "electron";

import type { UpdateState } from "./lib/updater";

contextBridge.exposeInMainWorld("installer", {
    defaults: () => ipcRenderer.invoke("defaults") as Promise<{ defaultHost: string; hubUrl: string; version: string; }>,
    apply: (host: string) => ipcRenderer.invoke("apply", host) as Promise<{ ok: boolean; domain: string; transport: string; }>,
    openHub: () => ipcRenderer.invoke("open-hub"),
    /** Estado atual do auto-update + assinatura das mudanças. */
    updateState: () => ipcRenderer.invoke("update-state") as Promise<UpdateState>,
    onUpdate: (cb: (s: UpdateState) => void) => {
        ipcRenderer.on("update-status", (_e, s: UpdateState) => cb(s));
    },
    openRelease: () => ipcRenderer.invoke("open-release"),
});
