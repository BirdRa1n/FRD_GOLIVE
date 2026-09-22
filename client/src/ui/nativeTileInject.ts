// Injeta a transmissão privada DENTRO do tile nativo do participante na grade de
// chamada do Discord, com expandir (teatro), tela cheia e menu de botão direito
// (volume, silenciar transmissão, silenciar sons) — como o tile nativo.
//
// Anchor: o atributo `data-selenium-video-tile="<userId>"` do Discord é estável
// (não é hasheado) e traz o ID do usuário — que é a `identity` das nossas streams.
// O Discord re-renderiza os tiles com frequência, então usamos um MutationObserver
// + um intervalo de segurança para reancorar o overlay quando ele some.
//
// FRÁGIL POR NATUREZA: depende da estrutura de DOM da grade do Discord. Se o
// Discord mudar o atributo, desligue em Configurações (nativeTileOverlay).

import { settings } from "../settings";
import { streamStore } from "../state/streamStore";
import { ICONS } from "./icons";
import { openStreamContextMenu } from "./StreamContextMenu";

const OVERLAY_CLASS = "frd-native-overlay";
const TILE_ATTR = "data-selenium-video-tile";

let observer: MutationObserver | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let running = false;

function cssEscape(value: string): string {
    const c = (window as { CSS?: { escape?(v: string): string; }; }).CSS;
    return c?.escape ? c.escape(value) : value.replace(/["\\]/g, "\\$&");
}

/** Impede que cliques/arrastes nos nossos controles cheguem ao tile do Discord. */
function isolate(el: HTMLElement): void {
    for (const type of ["click", "dblclick", "mousedown", "pointerdown", "contextmenu"]) {
        el.addEventListener(type, e => e.stopPropagation());
    }
}

function iconButton(title: string, icon: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "frd-native-btn";
    b.title = title;
    b.innerHTML = icon;
    b.onclick = e => {
        e.stopPropagation();
        onClick();
    };
    return b;
}

function buildOverlay(userId: string, stream: MediaStream): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = OVERLAY_CLASS;
    wrap.dataset.frdUser = userId;

    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true; // áudio sai pelo audioSink
    (video as HTMLVideoElement & { playsInline: boolean; }).playsInline = true;
    video.className = "frd-native-video";
    video.srcObject = stream;
    wrap.appendChild(video);

    // Canto superior direito: expandir (teatro) e tela cheia.
    const btns = document.createElement("div");
    btns.className = "frd-native-btns";
    btns.append(
        iconButton("Expandir", ICONS.expand, () => streamStore.setFocused(userId)),
        iconButton("Tela cheia", ICONS.fullscreen, () => void wrap.requestFullscreen?.()),
    );
    isolate(btns);
    wrap.appendChild(btns);

    // Selo "silenciado" (canto inferior esquerdo), como o ícone do Discord.
    const badge = document.createElement("span");
    badge.className = "frd-native-muted";
    badge.innerHTML = ICONS.volumeMuted;
    badge.title = "Transmissão silenciada — botão direito para opções";
    wrap.appendChild(badge);

    // Botão direito: menu nativo com volume, silenciar e sons (StreamContextMenu).
    wrap.addEventListener("contextmenu", e =>
        openStreamContextMenu(e, userId, () => void wrap.requestFullscreen?.()));

    updateOverlay(wrap, userId, stream);
    return wrap;
}

/** Reflete o estado atual (stream, mute) no overlay. */
function updateOverlay(ov: HTMLElement, userId: string, stream: MediaStream): void {
    const v = ov.querySelector("video");
    if (v && v.srcObject !== stream) v.srcObject = stream;

    const hasAudio = stream.getAudioTracks().length > 0;
    const silenced = hasAudio && (streamStore.isMuted(userId) || streamStore.getVolume(userId) === 0);
    ov.classList.toggle("frd-muted", silenced);
}

function sync(): void {
    if (!running) return;

    if (!settings.store.nativeTileOverlay) {
        document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());
        return;
    }

    const byId = new Map(streamStore.getStreams().map(s => [s.id, s]));

    // Remove overlays cujo stream sumiu ou que se soltaram do tile certo.
    document.querySelectorAll<HTMLElement>(`.${OVERLAY_CLASS}`).forEach(ov => {
        const uid = ov.dataset.frdUser;
        const tile = ov.closest(`[${TILE_ATTR}]`);
        if (!uid || !byId.has(uid) || !tile || tile.getAttribute(TILE_ATTR) !== uid) {
            ov.remove();
        }
    });

    // Injeta/atualiza em todos os tiles de cada usuário que transmite.
    for (const [uid, info] of byId) {
        document.querySelectorAll<HTMLElement>(`[${TILE_ATTR}="${cssEscape(uid)}"]`).forEach(tile => {
            const ov = tile.querySelector<HTMLDivElement>(`:scope > .${OVERLAY_CLASS}`);
            if (!ov) {
                if (getComputedStyle(tile).position === "static") tile.style.position = "relative";
                tile.appendChild(buildOverlay(uid, info.stream));
            } else {
                updateOverlay(ov, uid, info.stream);
            }
        });
    }
}

/** Reexecuta o sync com debounce (chamado pelo observer e pelo store). */
export function syncNativeTiles(): void {
    if (debounce) return;
    debounce = setTimeout(() => {
        debounce = null;
        sync();
    }, 200);
}

export function startNativeTiles(): void {
    if (running) return;
    running = true;
    observer = new MutationObserver(() => syncNativeTiles());
    observer.observe(document.body, { childList: true, subtree: true });
    interval = setInterval(sync, 1500); // rede de segurança
    sync();
}

export function stopNativeTiles(): void {
    running = false;
    observer?.disconnect();
    observer = null;
    if (interval) clearInterval(interval);
    interval = null;
    if (debounce) clearTimeout(debounce);
    debounce = null;
    document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach(el => el.remove());
}
