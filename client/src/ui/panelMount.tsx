// Monta o painel num container flutuante no <body>.
// Abordagem robusta e pouco invasiva para a Fase 2 — evita patches Webpack
// frágeis na UI da call. Uma integração mais "nativa" pode vir depois.

import { React, ReactDOM } from "@webpack/common";

import { PrivateStreamPanel } from "./PrivateStreamPanel";
import { SourcePicker } from "./SourcePicker";

let container: HTMLDivElement | null = null;
// createRoot retorna um Root do React 18; tipamos como unknown para não depender
// de @types/react-dom aqui.
let root: { render(node: unknown): void; unmount(): void; } | null = null;

export function mountPanel(): void {
    if (container) return;

    container = document.createElement("div");
    container.id = "frd-golive-root";
    document.body.appendChild(container);

    root = (ReactDOM as unknown as {
        createRoot(el: Element): { render(node: unknown): void; unmount(): void; };
    }).createRoot(container);
    root.render(
        React.createElement(
            React.Fragment,
            null,
            React.createElement(PrivateStreamPanel),
            React.createElement(SourcePicker),
        ),
    );
}

export function unmountPanel(): void {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
}
