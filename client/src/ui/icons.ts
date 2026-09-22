// Ícones SVG (strings) compartilhados entre o overlay em DOM puro e os
// componentes React. `currentColor` herda a cor do botão.

const svg = (path: string) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">${path}</svg>`;

const SPEAKER = "M3 9.5v5c0 .55.45 1 1 1h3l4.3 3.6c.65.54 1.7.08 1.7-.77V5.67c0-.85-1.05-1.31-1.7-.77L7 8.5H4c-.55 0-1 .45-1 1Z";

export const ICONS = {
    volumeHigh: svg(SPEAKER + "M15.5 8.4a1 1 0 0 1 1.41.05 5.2 5.2 0 0 1 0 7.1 1 1 0 1 1-1.46-1.37 3.2 3.2 0 0 0 0-4.36 1 1 0 0 1 .05-1.42ZM18.3 5.7a1 1 0 0 1 1.41 0 9.1 9.1 0 0 1 0 12.6 1 1 0 1 1-1.44-1.39 7.1 7.1 0 0 0 0-9.82 1 1 0 0 1 .03-1.4Z"),
    volumeLow: svg(SPEAKER + "M15.5 8.4a1 1 0 0 1 1.41.05 5.2 5.2 0 0 1 0 7.1 1 1 0 1 1-1.46-1.37 3.2 3.2 0 0 0 0-4.36 1 1 0 0 1 .05-1.42Z"),
    volumeMuted: svg(SPEAKER + "M16.3 9.3a1 1 0 0 1 1.4 0L19 10.6l1.3-1.3a1 1 0 1 1 1.4 1.4L20.4 12l1.3 1.3a1 1 0 0 1-1.4 1.4L19 13.4l-1.3 1.3a1 1 0 0 1-1.4-1.4l1.3-1.3-1.3-1.3a1 1 0 0 1 0-1.4Z"),
    expand: svg("M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 0 2H7.4l3.3 3.3a1 1 0 0 1-1.4 1.4L6 7.4V9a1 1 0 0 1-2 0V5Zm16 14a1 1 0 0 1-1 1h-4a1 1 0 1 1 0-2h1.6l-3.3-3.3a1 1 0 0 1 1.4-1.4l3.3 3.3V15a1 1 0 1 1 2 0v4Z"),
    fullscreen: svg("M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"),
} as const;

/** Ícone de alto-falante conforme o nível atual. */
export function volumeIcon(volume: number, muted: boolean): string {
    if (muted || volume === 0) return ICONS.volumeMuted;
    return volume < 0.5 ? ICONS.volumeLow : ICONS.volumeHigh;
}
