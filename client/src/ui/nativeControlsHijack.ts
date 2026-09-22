// "Sequestra" os botões nativos de câmera e compartilhar tela da barra de chamada:
// o clique passa a disparar a NOSSA captura privada em vez do Go Live do Discord
// (que fica "indisponível" em regiões censuradas).
//
// Anchor: os botões têm aria-describedby apontando para um <span> com o rótulo
// ("Câmera…", "Compartilhamento de tela…"). Casamos por palavra-chave (multi-idioma).
// FRÁGIL: depende do DOM/rotulagem do Discord — desligue em hijackNativeControls.

import { startCameraShare, startScreenShare, stopSharing } from "../rtc/controller";
import { settings } from "../settings";
import { streamStore } from "../state/streamStore";

type Kind = "screen" | "camera";

// Cobre tanto o rótulo bloqueado ("Compartilhamento de tela indisponível") quanto
// o habilitado ("Compartilhar tela" / "Transmitir" / "Go Live" etc.).
const SCREEN_RE = /\btela\b|screen|compartilh|transmit|go.?live|ao.?vivo|pantalla|écran|ecran|bildschirm|schermo|scherm|画面|화면/i;
const CAMERA_RE = /câmera|camera|cámara|caméra|kamera|webcam/i;

const ACTIVE_CLASS = "frd-native-active";

let observer: MutationObserver | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let running = false;
const bound: Array<{ el: HTMLElement; handler: EventListener; }> = [];

function describedText(btn: HTMLElement): string {
    const id = btn.getAttribute("aria-describedby");
    if (!id) return "";
    return document.getElementById(id)?.textContent ?? "";
}

function classify(btn: HTMLElement): Kind | null {
    const existing = btn.dataset.frdHijack;
    if (existing === "screen" || existing === "camera") return existing;
    const t = describedText(btn);
    if (SCREEN_RE.test(t)) return "screen";
    if (CAMERA_RE.test(t)) return "camera";
    return null;
}

function makeHandler(kind: Kind): EventListener {
    return (e: Event) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        // toggle: clicar de novo no que já está transmitindo, para.
        if (streamStore.sharingKind === kind) {
            void stopSharing();
        } else if (kind === "screen") {
            void startScreenShare();
        } else {
            void startCameraShare();
        }
    };
}

function sync(): void {
    if (!running || !settings.store.hijackNativeControls) return;

    document.querySelectorAll<HTMLElement>("button[aria-describedby]").forEach(btn => {
        const kind = classify(btn);
        if (!kind) return;

        if (btn.dataset.frdHijack !== kind) {
            btn.dataset.frdHijack = kind;
            const handler = makeHandler(kind);
            btn.addEventListener("click", handler, true);
            bound.push({ el: btn, handler });
        }
        btn.classList.toggle(ACTIVE_CLASS, streamStore.sharingKind === kind);
    });
}

export function syncNativeControls(): void {
    if (debounce) return;
    debounce = setTimeout(() => {
        debounce = null;
        sync();
    }, 200);
}

export function startNativeControls(): void {
    if (running) return;
    running = true;
    observer = new MutationObserver(() => syncNativeControls());
    observer.observe(document.body, { childList: true, subtree: true });
    interval = setInterval(sync, 1500);
    sync();
}

export function stopNativeControls(): void {
    running = false;
    observer?.disconnect();
    observer = null;
    if (interval) clearInterval(interval);
    interval = null;
    if (debounce) clearTimeout(debounce);
    debounce = null;
    for (const { el, handler } of bound) {
        el.removeEventListener("click", handler, true);
        delete el.dataset.frdHijack;
        el.classList.remove(ACTIVE_CLASS);
    }
    bound.length = 0;
}
