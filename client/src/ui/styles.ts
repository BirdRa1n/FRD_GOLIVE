// CSS do plugin (chip, overlay nos tiles, teatro, picker), injetado como <style>
// no start. Cores via variáveis do próprio Discord para seguir o tema do cliente.

const CSS = `
/* --- Botões e status (chip de conexão, teatro) --- */
#frd-golive-root .frd-btn {
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
    font-weight: 500;
    color: #fff;
    background: var(--brand-500, #5865f2);
}
#frd-golive-root .frd-btn:hover { filter: brightness(1.1); }
#frd-golive-root .frd-btn-stop { background: var(--status-danger, #da373c); }
#frd-golive-root .frd-btn-secondary { background: var(--background-modifier-selected, #4e5058); }
#frd-golive-root .frd-btn:disabled { opacity: 0.5; cursor: not-allowed; }
#frd-golive-root .frd-retry { flex-shrink: 0; }
#frd-golive-root .frd-live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-danger, #f23f43);
    animation: frd-pulse 1.4s ease-in-out infinite;
}
@keyframes frd-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
}

/* --- Chip discreto de status (canto inferior direito) --- */
#frd-golive-root .frd-chip {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 3000;
    max-width: 320px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    background: var(--background-secondary, #2b2d31);
    color: var(--text-normal, #dbdee1);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
#frd-golive-root .frd-chip-error { color: var(--text-danger, #f23f43); }

/* --- Botão nativo do Discord sequestrado, em estado "transmitindo" --- */
button.frd-native-active svg {
    color: var(--status-danger, #f23f43) !important;
    fill: var(--status-danger, #f23f43) !important;
}

/* --- Overlay no tile nativo do Discord --- */
.frd-native-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    border-radius: inherit;
    overflow: hidden;
    background: #000;
}
.frd-native-overlay:fullscreen { border-radius: 0; }
.frd-native-video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
}
.frd-native-btns {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 6px;
    opacity: 0;
    transition: opacity 0.12s;
}
.frd-native-overlay:hover .frd-native-btns { opacity: 1; }
.frd-native-btn {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    transition: background 0.12s, transform 0.12s;
}
.frd-native-btn:hover { background: var(--brand-500, #5865f2); }
.frd-native-btn:active { transform: scale(0.94); }
.frd-native-btn svg { display: block; }
/* selo de silenciado (definido no menu de botão direito) */
.frd-native-muted {
    position: absolute;
    left: 8px;
    bottom: 8px;
    width: 28px;
    height: 28px;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    background: var(--status-danger, #da373c);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}
.frd-native-muted svg { width: 16px; height: 16px; }
.frd-native-overlay.frd-muted .frd-native-muted { display: flex; }

/* --- Modo teatro --- */
#frd-golive-root .frd-theater {
    position: fixed;
    inset: 0;
    z-index: 3200;
    display: flex;
    flex-direction: column;
    background: rgba(0, 0, 0, 0.92);
    color: var(--text-normal, #dbdee1);
}
#frd-golive-root .frd-theater-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
}
#frd-golive-root .frd-theater-name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
}
#frd-golive-root .frd-theater-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}
#frd-golive-root .frd-theater-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
}
#frd-golive-root .frd-theater-video {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
#frd-golive-root .frd-theater-strip {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    overflow-x: auto;
}
#frd-golive-root .frd-strip-item {
    position: relative;
    flex: 0 0 auto;
    width: 160px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    background: #000;
    cursor: pointer;
}
#frd-golive-root .frd-strip-active { border-color: var(--brand-500, #5865f2); }
#frd-golive-root .frd-strip-video {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
}
#frd-golive-root .frd-strip-name {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 11px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
}

/* --- Picker de transmissão (renderizado no Modal nativo do Discord) --- */
.frd-gl { display: flex; flex-direction: column; gap: 16px; padding-bottom: 4px; }
.frd-gl-tabs {
    display: flex;
    gap: 20px;
    border-bottom: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
}
.frd-gl-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -1px;
    padding: 0 0 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: 500;
    color: var(--interactive-normal, #b5bac1);
}
.frd-gl-tab:hover { color: var(--interactive-hover, #dbdee1); }
.frd-gl-tab-on {
    color: var(--interactive-active, #fff);
    border-bottom-color: var(--brand-500, #5865f2);
}
.frd-gl-count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    font-size: 12px;
    line-height: 18px;
    text-align: center;
    background: var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
    color: var(--text-muted, #949ba4);
}
.frd-gl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px 12px;
    max-height: 340px;
    overflow-y: auto;
    padding: 4px;
    margin: -4px;
}
.frd-gl-source {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    color: var(--interactive-normal, #b5bac1);
}
.frd-gl-thumb {
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: 8px;
    overflow: hidden;
    background: var(--background-tertiary, #1e1f22);
    outline: 2px solid transparent;
    outline-offset: 2px;
    transition: outline-color 0.15s, transform 0.15s;
}
.frd-gl-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
.frd-gl-source:hover .frd-gl-thumb { outline-color: var(--background-modifier-accent, rgba(78, 80, 88, 0.8)); }
.frd-gl-source-on .frd-gl-thumb,
.frd-gl-source:focus-visible .frd-gl-thumb { outline-color: var(--brand-500, #5865f2); }
.frd-gl-source-on { color: var(--header-primary, #f2f3f5); }
.frd-gl-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 14px;
    font-weight: 500;
}
.frd-gl-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frd-gl-appicon { width: 16px; height: 16px; flex: none; }
.frd-gl-empty {
    padding: 28px 12px;
    border-radius: 8px;
    text-align: center;
    font-size: 14px;
    color: var(--text-muted, #949ba4);
    background: var(--background-secondary, #2b2d31);
}
.frd-gl-quality {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
}
.frd-gl-quality-title { font-size: 16px; font-weight: 600; color: var(--header-primary, #f2f3f5); }
.frd-gl-quality-row { display: flex; flex-wrap: wrap; gap: 16px 28px; }
.frd-gl-field { display: flex; flex-direction: column; gap: 8px; }
.frd-gl-eyebrow {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--header-secondary, #b5bac1);
}
.frd-gl-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.frd-gl-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, 0.48));
    border-radius: 16px;
    background: var(--background-primary, #313338);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--interactive-normal, #b5bac1);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.frd-gl-pill:hover:not(:disabled) { color: var(--interactive-hover, #dbdee1); border-color: var(--interactive-muted, #4e5058); }
.frd-gl-pill-on,
.frd-gl-pill-on:hover:not(:disabled) {
    background: var(--brand-500, #5865f2);
    border-color: var(--brand-500, #5865f2);
    color: #fff;
}
.frd-gl-pill:disabled { opacity: 0.45; cursor: not-allowed; }
.frd-gl-lock { flex: none; }
.frd-gl-hint { font-size: 12px; color: var(--text-muted, #949ba4); }
.frd-gl-audio { display: flex; align-items: center; margin-right: auto; }
.frd-gl-audio-label { font-size: 14px; color: var(--text-normal, #dbdee1); }
`;

let styleEl: HTMLStyleElement | null = null;

export function injectStyles(): void {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.id = "frd-golive-styles";
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
}

export function removeStyles(): void {
    styleEl?.remove();
    styleEl = null;
}
