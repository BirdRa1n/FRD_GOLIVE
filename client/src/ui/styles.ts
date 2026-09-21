// CSS do painel, injetado como <style> no onStart do plugin.

const CSS = `
#frd-golive-root .frd-panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 3000;
    width: 340px;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--background-secondary, #2b2d31);
    border: 1px solid var(--background-tertiary, #1e1f22);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    color: var(--text-normal, #dbdee1);
    font-size: 14px;
    overflow: hidden;
}
#frd-golive-root .frd-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--background-tertiary, #1e1f22);
}
#frd-golive-root .frd-title {
    font-weight: 600;
}
#frd-golive-root .frd-btn {
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    color: #fff;
    background: var(--brand-500, #5865f2);
}
#frd-golive-root .frd-btn-stop {
    background: var(--status-danger, #da373c);
}
#frd-golive-root .frd-btn-secondary {
    background: var(--background-modifier-selected, #4e5058);
}
#frd-golive-root .frd-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
#frd-golive-root .frd-actions {
    display: flex;
    gap: 8px;
    padding: 8px 12px 0;
}
#frd-golive-root .frd-actions .frd-btn {
    flex: 1;
}
#frd-golive-root .frd-live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--status-danger, #f23f43);
}
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
#frd-golive-root .frd-status {
    padding: 6px 12px;
    font-size: 13px;
    background: var(--background-tertiary, #1e1f22);
    color: var(--text-muted, #949ba4);
}
#frd-golive-root .frd-status-warn {
    color: var(--text-warning, #f0b232);
}
#frd-golive-root .frd-status-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-danger, #f23f43);
}
#frd-golive-root .frd-retry {
    background: var(--brand-500, #5865f2);
    flex-shrink: 0;
}
#frd-golive-root .frd-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow-y: auto;
}
#frd-golive-root .frd-tile {
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    background: #000;
}
#frd-golive-root .frd-video {
    width: 100%;
    display: block;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background: #000;
}
#frd-golive-root .frd-name {
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    background: rgba(0, 0, 0, 0.6);
}
#frd-golive-root .frd-empty {
    padding: 16px;
    text-align: center;
    color: var(--text-muted, #949ba4);
}
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
