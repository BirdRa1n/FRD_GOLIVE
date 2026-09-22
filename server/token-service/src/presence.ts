// Verificação de presença em canal de voz via bot do Discord.
//
// Mantém um cliente discord.js conectado ao gateway, com o cache de voice states,
// e responde se um dado usuário está mesmo conectado a um dado canal de voz.
// É o que impede que alguém de posse apenas do segredo + ID do canal obtenha
// um token para uma sala em que não está.

import { Client, Events, GatewayIntentBits } from "discord.js";

export type PresenceResult =
    | "present" // usuário está no canal de voz
    | "absent" // canal é visível ao bot, mas o usuário não está nele
    | "unknown"; // canal não é visível ao bot (ex.: DM/grupo, ou outro servidor)

let client: Client | null = null;
let ready = false;

export async function startPresence(botToken: string): Promise<void> {
    client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    client.once(Events.ClientReady, c => {
        ready = true;
        console.log(`[presence] bot conectado como ${c.user.tag}`);
    });
    client.on(Events.Error, err => console.error("[presence] erro do gateway:", err));

    await client.login(botToken);
}

export function isReady(): boolean {
    return ready;
}

/** Retorna se `userId` está conectado ao canal de voz `channelId`. */
export function checkVoicePresence(channelId: string, userId: string): PresenceResult {
    if (!client || !ready) return "unknown";

    for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) continue; // canal não é deste servidor

        const voiceState = guild.voiceStates.cache.get(userId);
        return voiceState?.channelId === channelId ? "present" : "absent";
    }

    return "unknown"; // nenhum servidor visível ao bot contém esse canal
}
