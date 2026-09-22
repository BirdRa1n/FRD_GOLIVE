// Monta o painel num container flutuante no <body>.
// Abordagem robusta e pouco invasiva — evita patches Webpack frágeis na UI da call.
//
// O `ReactDOM` de @webpack/common nem sempre expõe `createRoot` (versões do
// Discord variam), então pegamos o módulo do createRoot direto do Webpack.

import { findByPropsLazy } from "@webpack";
import { React } from "@webpack/common";

import { PrivateStreamPanel } from "./PrivateStreamPanel";
import { SourcePicker } from "./SourcePicker";

// react-dom/client — o módulo que expõe createRoot no bundle do Discord.
const ReactDOMClient: {
    createRoot(el: Element): { render(node: unknown): void; unmount(): void; };
} = findByPropsLazy("createRoot", "hydrateRoot");

let container: HTMLDivElement | null = null;
let root: { render(node: unknown): void; unmount(): void; } | null = null;

export function mountPanel(): void {
    if (container) return;

    container = document.createElement("div");
    container.id = "frd-golive-root";
    document.body.appendChild(container);

    root = ReactDOMClient.createRoot(container);
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
