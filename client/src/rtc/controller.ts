// Orquestra a sessão RTC de acordo com o estado do Discord e das configurações.
// Acopla session.ts (puro) + streamStore (puro) + settings/discordState (Vencord).

import { getLocalUser } from "../discordState";
import { settings } from "../settings";
import { streamStore } from "../state/streamStore";
import { RtcSession } from "./session";

let session: RtcSession | null = null;
let currentRoom: string | null = null;

async function fetchToken(room: string, identity: string, name: string): Promise<string> {
    const base = settings.store.tokenServiceUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, identity, name, orgSecret: settings.store.orgSecret }),
    });
    if (!res.ok) throw new Error(`token-service respondeu ${res.status}`);
    const data = await res.json() as { token?: string; };
    if (!data.token) throw new Error("token-service não retornou um token");
    return data.token;
}

export async function connectToChannel(channelId: string): Promise<void> {
    if (currentRoom === channelId && session?.isConnected) return;
    await disconnect();

    const user = getLocalUser();
    if (!user) return;

    if (!settings.store.orgSecret) {
        console.warn("[FRD GoLive] orgSecret não configurado — não conectando ao servidor privado.");
        return;
    }

    session = new RtcSession({
        onStreamAdded: info => streamStore.upsert(info),
        onStreamUpdated: info => streamStore.upsert(info),
        onStreamRemoved: id => streamStore.remove(id),
        onConnected: () => streamStore.setConnected(true),
        onDisconnected: () => streamStore.setConnected(false),
    });

    const token = await fetchToken(channelId, user.id, user.username);
    await session.connect(settings.store.serverUrl, token);
    currentRoom = channelId;
}

export async function disconnect(): Promise<void> {
    if (session) {
        await session.disconnect();
        session = null;
    }
    currentRoom = null;
    streamStore.reset();
}

export async function startScreenShare(): Promise<void> {
    if (!session) throw new Error("Conecte-se a um canal de voz primeiro.");
    await session.shareScreen({
        systemAudio: settings.store.includeSystemAudio,
        maxHeight: Number(settings.store.maxHeight),
        fps: Number(settings.store.fps),
    });
    streamStore.setSharing(true);
}

export async function startCameraShare(): Promise<void> {
    if (!session) throw new Error("Conecte-se a um canal de voz primeiro.");
    await session.shareCamera();
    streamStore.setSharing(true);
}

export async function stopSharing(): Promise<void> {
    if (!session) return;
    await session.stopSharing();
    streamStore.setSharing(false);
}

/** Chamado quando o canal de voz selecionado muda (ou fica null ao sair). */
export function onVoiceChannelChange(channelId: string | null): void {
    if (channelId) {
        connectToChannel(channelId).catch(e => console.error("[FRD GoLive]", e));
    } else {
        disconnect().catch(e => console.error("[FRD GoLive]", e));
    }
}
