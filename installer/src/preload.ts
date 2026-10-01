import { contextBridge, ipcRenderer } from "electron";

import type { UpdateState } from "./lib/updater";

interface Probe {
    ok: boolean;
    latencyMs?: number;
    version?: string;
    transport?: string;
    authMode?: string;
    oauth?: boolean;
    error?: string;
}
interface Group { guildId: string; guildName: string; icon?: string; }

contextBridge.exposeInMainWorld("installer", {
    defaults: () => ipcRenderer.invoke("defaults") as Promise<{ host: string; version: string; }>,
    probe: (host: string) => ipcRenderer.invoke("probe", host) as Promise<Probe>,
    groups: (host: string) => ipcRenderer.invoke("groups", host) as Promise<Group[]>,
    apply: (host: string) => ipcRenderer.invoke("apply", host) as Promise<{ ok: boolean; domain: string; transport: string; }>,
    openHub: (host: string) => ipcRenderer.invoke("open-hub", host),
    updateState: () => ipcRenderer.invoke("update-state") as Promise<UpdateState>,
    onUpdate: (cb: (s: UpdateState) => void) => {
        ipcRenderer.on("update-status", (_e, s: UpdateState) => cb(s));
    },
    openRelease: () => ipcRenderer.invoke("open-release"),
});
