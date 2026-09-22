// Injeta a transmissão privada DENTRO do tile nativo do participante na grade de
// chamada do Discord, com volume da transmissão, expandir (teatro) e tela cheia.
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
import { ICONS, volumeIcon } from "./icons";

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

    // Canto inferior esquerdo: volume da transmissão (só para quem assiste).
    const bar = document.createElement("div");
    bar.className = "frd-vol";
    const mute = iconButton("Silenciar", ICONS.volumeHigh, () => streamStore.toggleMute(userId));
    mute.classList.add("frd-vol-btn");
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.step = "1";
    range.className = "frd-vol-range";
    range.setAttribute("aria-label", "Volume da transmissão");
    range.oninput = () => streamStore.setVolume(userId, Number(range.value) / 100);
    // Enquanto arrasta, o sync (com debounce) não reescreve o valor do slider.
    range.onpointerdown = () => { range.dataset.dragging = "1"; };
    range.onpointerup = range.onpointercancel = () => { delete range.dataset.dragging; };
    const pct = document.createElement("span");
    pct.className = "frd-vol-pct";
    bar.append(mute, range, pct);
    // Roda do mouse sobre a barra: ±5%.
    bar.addEventListener("wheel", e => {
        e.preventDefault();
        e.stopPropagation();
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        streamStore.setVolume(userId, streamStore.getVolume(userId) + step);
    }, { passive: false });
    isolate(bar);
    wrap.appendChild(bar);

    updateOverlay(wrap, userId, stream);
    return wrap;
}

/** Reflete o estado atual (stream, volume, mute, se há áudio) no overlay. */
function updateOverlay(ov: HTMLElement, userId: string, stream: MediaStream): void {
    const v = ov.querySelector("video");
    if (v && v.srcObject !== stream) v.srcObject = stream;

    const hasAudio = stream.getAudioTracks().length > 0;
    const volume = streamStore.getVolume(userId);
    const muted = streamStore.isMuted(userId);
    const shown = muted ? 0 : volume;

    ov.classList.toggle("frd-no-audio", !hasAudio);
    ov.classList.toggle("frd-muted", hasAudio && (muted || volume === 0));

    const btn = ov.querySelector<HTMLButtonElement>(".frd-vol-btn");
    if (btn) {
        btn.innerHTML = volumeIcon(volume, muted || !hasAudio);
        btn.title = !hasAudio ? "Transmissão sem áudio" : muted ? "Ativar som" : "Silenciar";
        btn.disabled = !hasAudio;
    }
    const range = ov.querySelector<HTMLInputElement>(".frd-vol-range");
    if (range) {
        const value = String(Math.round(shown * 100));
        if (!range.dataset.dragging && range.value !== value) range.value = value;
        range.disabled = !hasAudio;
        range.style.setProperty("--frd-fill", `${Math.round(shown * 100)}%`);
    }
    const pct = ov.querySelector<HTMLSpanElement>(".frd-vol-pct");
    if (pct) pct.textContent = hasAudio ? `${Math.round(shown * 100)}%` : "sem áudio";
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
