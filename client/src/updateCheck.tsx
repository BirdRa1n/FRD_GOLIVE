import { showNotice } from "@api/Notices";
import { Alerts, Parser } from "@webpack/common";

import type { ReleaseCheck, ReleaseInfo } from "./types";
import { compareVersions, FRD_REPO, FRD_VERSION } from "./version";

// Avisa quando há uma versão nova do FRD GoLive nas releases do GitHub: um modal com
// os changelogs (markdown das releases) + a faixa de aviso no topo do Discord.

const FIRST_CHECK_MS = 20_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RELEASES_PAGE = `https://github.com/${FRD_REPO}/releases/latest`;

interface ReleaseHelper {
    releasesFetch(): Promise<ReleaseCheck>;
}

let firstTimer: ReturnType<typeof setTimeout> | null = null;
let everyTimer: ReturnType<typeof setInterval> | null = null;
let shownTag = "";

function getHelper(): ReleaseHelper | null {
    const helpers = (window as { VencordNative?: { pluginHelpers?: Record<string, unknown>; }; })
        .VencordNative?.pluginHelpers;
    const helper = helpers?.FRDGoLive as Partial<ReleaseHelper> | undefined;
    // Renderer novo com main antigo (Ctrl+R sem reiniciar o Discord): só checa depois de reiniciar.
    return typeof helper?.releasesFetch === "function" ? helper as ReleaseHelper : null;
}

function openExternal(url: string): void {
    const native = (window as { VencordNative?: { native?: { openExternal?(u: string): Promise<void>; }; }; })
        .VencordNative?.native;
    if (native?.openExternal) void native.openExternal(url);
    else window.open(url, "_blank");
}

/** Markdown do GitHub → o que o parser do Discord entende bem. */
function toDiscordMarkdown(release: ReleaseInfo): string {
    const body = release.body
        .replace(/\r\n/g, "\n")
        .replace(/<!--[\s\S]*?-->/g, "")
        // títulos da release viram subtítulos (o título de cada versão é o ##)
        .replace(/^#{1,6}\s+/gm, "### ")
        // links de PR/issue longos → [#48](url)
        .replace(/(?<!\()https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)/g, (url, n) => `[#${n}](${url})`)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const date = release.publishedAt ? ` — ${new Date(release.publishedAt).toLocaleDateString()}` : "";
    return `## ${release.name}${date}\n${body || "_Sem notas para esta versão._"}`;
}

function renderMarkdown(md: string): React.ReactNode {
    try {
        return Parser.parse(md, false, { allowLinks: true, allowHeading: true, allowList: true });
    } catch {
        return <pre style={{ whiteSpace: "pre-wrap" }}>{md}</pre>;
    }
}

function showUpdate(newer: ReleaseInfo[]): void {
    const latest = newer[0];
    const download = () => openExternal(latest.url || RELEASES_PAGE);
    const changelog = newer.map(toDiscordMarkdown).join("\n\n");

    Alerts.show({
        title: `Atualização do FRD GoLive disponível (${latest.tag})`,
        body: (
            <div style={{ maxHeight: "55vh", overflowY: "auto", paddingRight: 8 }}>
                <p style={{ marginBottom: 12 }}>
                    Você está na versão <b>v{FRD_VERSION.replace(/^v/, "")}</b>. Baixe o instalador novo do FRD GoLive
                    e rode-o para atualizar o Discord — versões antigas podem parar de transmitir.
                </p>
                {renderMarkdown(changelog)}
            </div>
        ),
        confirmText: "Baixar atualização",
        cancelText: "Depois",
        onConfirm: download,
    });

    showNotice({
        message: `Há uma versão nova do FRD GoLive (${latest.tag}). Baixe o instalador novo para atualizar.`,
        buttonText: "Baixar",
        callback: ({ dismiss }) => {
            download();
            void dismiss();
        },
    });
}

async function checkNow(): Promise<void> {
    const helper = getHelper();
    if (!helper) return;
    const res = await helper.releasesFetch().catch(e => ({ ok: false, error: String(e) }) as ReleaseCheck);
    if (!res.ok) {
        console.warn("[FRD GoLive] verificação de atualização falhou:", res.error);
        return;
    }
    const newer = res.releases
        .filter(r => compareVersions(r.tag, FRD_VERSION) > 0)
        .sort((a, b) => compareVersions(b.tag, a.tag));
    if (!newer.length || newer[0].tag === shownTag) return;
    shownTag = newer[0].tag;
    console.info(`[FRD GoLive] atualização disponível: ${newer[0].tag} (instalada: ${FRD_VERSION})`);
    showUpdate(newer);
}

export function startUpdateCheck(): void {
    if (firstTimer || everyTimer) return;
    firstTimer = setTimeout(() => {
        firstTimer = null;
        void checkNow();
    }, FIRST_CHECK_MS);
    everyTimer = setInterval(() => void checkNow(), CHECK_EVERY_MS);
}

export function stopUpdateCheck(): void {
    if (firstTimer) clearTimeout(firstTimer);
    if (everyTimer) clearInterval(everyTimer);
    firstTimer = everyTimer = null;
}
