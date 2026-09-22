// Monta o painel num container flutuante no <body>.
// Abordagem robusta e pouco invasiva — evita patches Webpack frágeis na UI da call.
//
// A forma de montar um root React varia conforme a versão do React que o Discord
// usa: React 18+ tem `createRoot`; o `ReactDOM` legado tem `render`. Tentamos as
// duas, mais um fallback via Webpack, para funcionar em qualquer build.

import { findByPropsLazy } from "@webpack";
import { React, ReactDOM } from "@webpack/common";

import { PrivateStreamPanel } from "./PrivateStreamPanel";
import { SourcePicker } from "./SourcePicker";
import { TheaterView } from "./TheaterView";

type MinimalRoot = { render(node: unknown): void; unmount(): void; };
type ReactDOMLike = {
    createRoot?(el: Element): MinimalRoot;
    render?(node: unknown, el: Element): void;
    unmountComponentAtNode?(el: Element): void;
};

// Fallback: módulo do react-dom/client (createRoot) caso o ReactDOM comum não sirva.
const ReactDOMClient = findByPropsLazy("createRoot") as ReactDOMLike;

let container: HTMLDivElement | null = null;
let root: MinimalRoot | null = null;

function tree(): unknown {
    return React.createElement(
        React.Fragment,
        null,
        React.createElement(PrivateStreamPanel),
        React.createElement(SourcePicker),
        React.createElement(TheaterView),
    );
}

export function mountPanel(): void {
    if (container) return;

    container = document.createElement("div");
    container.id = "frd-golive-root";
    document.body.appendChild(container);

    const rd = ReactDOM as ReactDOMLike;
    const node = tree();

    if (typeof rd.createRoot === "function") {
        root = rd.createRoot(container);
        root.render(node);
    } else if (typeof rd.render === "function") {
        // react-dom legado (React 18): render + unmountComponentAtNode
        rd.render(node, container);
        root = { render: n => rd.render!(n, container!), unmount: () => rd.unmountComponentAtNode?.(container!) };
    } else {
        // último recurso: createRoot achado via Webpack
        root = ReactDOMClient.createRoot!(container);
        root.render(node);
    }
}

export function unmountPanel(): void {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
}
