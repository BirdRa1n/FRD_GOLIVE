// Ponte fina com as stores do Discord (via Webpack do Vencord).
// Só validável dentro do build do Vencord.

import { SelectedChannelStore, UserStore } from "@webpack/common";

export interface LocalUser {
    id: string;
    username: string;
}

/** ID do canal de voz em que o usuário está conectado, ou null. */
export function getCurrentVoiceChannelId(): string | null {
    return SelectedChannelStore.getVoiceChannelId() ?? null;
}

export function getLocalUser(): LocalUser | null {
    const user = UserStore.getCurrentUser();
    if (!user) return null;
    return {
        id: user.id,
        // globalName quando existe, senão o username clássico
        username: (user as { globalName?: string; username: string; }).globalName || user.username,
    };
}
