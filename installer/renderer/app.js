/* global window, document */
const api = window.installer;
const ui = window.FRDUI;
const $ = id => document.getElementById(id);

const log = $("log");
const hostInput = $("host");
const applyBtn = $("apply");

if (/Mac/i.test(navigator.platform)) document.body.classList.add("mac");

function currentHost() {
    let h = hostInput.value.trim().replace(/\/+$/, "");
    if (h && !/^https?:\/\//i.test(h)) h = "https://" + h;
    return h;
}

function say(msg, tone) {
    log.textContent = msg;
    log.className = "caption" + (tone === "err" ? " text-danger" : tone === "ok" ? " text-ok" : "");
}

let checkSeq = 0;
let checkTimer = null;
let lastProbe = null;

function setCheck(state, title, detail) {
    const icon = $("check-icon");
    icon.className = "icon-tile " + (state === "ok" ? "ok" : state === "err" ? "danger" : "neutral");
    icon.innerHTML = ui.icon(state === "ok" ? "check" : state === "err" ? "alert" : "server");
    $("check-title").textContent = title;
    $("check-detail").textContent = detail || "";
    $("check-acc").innerHTML = state === "loading" ? '<span class="spinner"></span>' : "";
}

function renderMode(p) {
    const box = $("mode-box");
    if (!p || !p.ok) { box.hidden = true; $("groups-box").hidden = true; return; }
    box.hidden = false;
    const channels = p.authMode === "channels";
    $("mode-icon").className = "icon-tile " + (channels ? "gradient" : "");
    $("mode-icon").innerHTML = ui.icon(channels ? "users" : "discord");
    $("mode-title").textContent = channels ? "Acesso por grupos permitidos" : "Login do Discord";
    $("mode-detail").textContent = channels
        ? "Você transmite em qualquer canal de voz habilitado pelo admin — sem pedir acesso."
        : p.oauth
            ? "Entre com o Discord no site e peça acesso; um admin libera a sua conta."
            : "O servidor pede login do Discord, mas o OAuth não está configurado nele.";
    if (channels) loadGroups();
    else $("groups-box").hidden = true;
}

async function loadGroups() {
    const host = currentHost();
    const box = $("groups-box");
    const list = $("groups-list");
    const groups = await api.groups(host).catch(() => []);
    if (!groups.length) { box.hidden = true; return; }
    box.hidden = false;
    list.innerHTML = groups.map(g =>
        '<div class="row">' + ui.thumb(g.icon || "", g.guildName || g.guildId, true) +
        '<div class="row-body"><div class="row-title">' + ui.escapeHtml(g.guildName || g.guildId) + "</div></div></div>"
    ).join("");
}

async function checkServer() {
    const host = currentHost();
    const seq = ++checkSeq;
    if (!host) { setCheck("idle", "Informe o host do servidor", ""); renderMode(null); return; }
    if (!/^https?:\/\//i.test(host)) { setCheck("err", "Host inválido", "Use https://seu-servidor"); renderMode(null); return; }

    setCheck("loading", "Verificando o servidor…", host);
    const p = await api.probe(host);
    if (seq !== checkSeq) return;
    lastProbe = p;
    if (p.ok) {
        setCheck("ok", "Servidor online", `v${p.version ?? "?"} · ${p.transport ?? "?"} · ${p.latencyMs} ms`);
    } else {
        setCheck("err", "Servidor inacessível", p.error === "timeout" ? "sem resposta em 6 s" : host);
    }
    renderMode(p);
}

function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkServer, 450);
}

api.defaults().then(d => {
    $("version").textContent = d.version ? `FRD GoLive Instalador v${d.version}` : "";
    if (d.host) hostInput.value = d.host;
    checkServer();
});

function renderUpdate(s) {
    const box = $("update");
    const text = $("update-text");
    const bar = $("update-progress");
    const action = $("update-action");
    action.hidden = true;
    bar.hidden = true;
    box.className = "notice";

    switch (s.state) {
        case "downloading":
            box.hidden = false;
            text.textContent = `Baixando a versão ${s.version}… ${s.percent}%`;
            bar.hidden = false;
            bar.style.setProperty("--value", s.percent + "%");
            break;
        case "installing":
            box.hidden = false;
            text.textContent = `Instalando a versão ${s.version} — o app reinicia sozinho.`;
            bar.hidden = false;
            bar.classList.add("indeterminate");
            break;
        case "manual":
            box.hidden = false;
            box.className = "notice warn";
            text.textContent = `A versão ${s.version} está disponível. Baixe e instale para atualizar.`;
            action.hidden = false;
            action.onclick = () => api.openRelease();
            break;
        case "error":
            box.hidden = true;
            break;
        default:
            box.hidden = true;
    }
}
api.updateState().then(renderUpdate);
api.onUpdate(renderUpdate);

hostInput.addEventListener("input", () => {
    hostInput.removeAttribute("aria-invalid");
    scheduleCheck();
});

applyBtn.addEventListener("click", async () => {
    const host = currentHost();
    if (!host) {
        hostInput.setAttribute("aria-invalid", "true");
        say("Informe o host do seu servidor.", "err");
        hostInput.focus();
        return;
    }

    applyBtn.disabled = true;
    applyBtn.setAttribute("aria-busy", "true");
    applyBtn.textContent = "Aplicando…";
    $("progress").hidden = false;
    say("Buscando a config no servidor e aplicando a modificação…");
    try {
        const r = await api.apply(host);
        $("done-msg").textContent = `Servidor ${r.domain} · transporte ${r.transport}. Reinicie o Discord se ele estiver aberto.`;
        const channels = lastProbe && lastProbe.authMode === "channels";
        $("done-caption").textContent = channels
            ? "Entre numa call de voz num grupo habilitado e use os botões de tela do Discord."
            : "Entre no site para pedir acesso. Quando o admin liberar, o Discord liga as funções sozinho.";
        $("open-hub").textContent = channels ? "Abrir o site" : "Abrir o site e pedir acesso";
        $("step-config").hidden = true;
        $("step-done").hidden = false;
        ui.toast("Modificação aplicada", "ok");
    } catch (e) {
        say("Falha: " + (e && e.message ? e.message : e), "err");
    } finally {
        applyBtn.disabled = false;
        applyBtn.removeAttribute("aria-busy");
        applyBtn.textContent = "Aplicar modificação";
        $("progress").hidden = true;
    }
});

$("open-hub").addEventListener("click", () => api.openHub(currentHost()));
$("restart").addEventListener("click", () => {
    $("step-done").hidden = true;
    $("step-config").hidden = false;
    say("");
});
