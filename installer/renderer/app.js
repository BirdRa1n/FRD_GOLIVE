/* global window, document */
const api = window.installer;
const ui = window.FRDUI;
const $ = id => document.getElementById(id);

const log = $("log");
const hostInput = $("host");
const applyBtn = $("apply");

if (/Mac/i.test(navigator.platform)) document.body.classList.add("mac");

let defaults = { defaultHost: "", hubUrl: "" };
let useOwn = false;

function currentHost() {
    return (useOwn ? hostInput.value.trim() : defaults.defaultHost).replace(/\/+$/, "");
}

function say(msg, tone) {
    log.textContent = msg;
    log.className = "caption" + (tone === "err" ? " text-danger" : tone === "ok" ? " text-ok" : "");
}

// ------------------------------------------------------------ verificação
// Confere GET /health antes de aplicar: mostra versão, transporte e latência.
let checkSeq = 0;
let checkTimer = null;

function setCheck(state, title, detail) {
    const icon = $("check-icon");
    icon.className = "icon-tile " + (state === "ok" ? "ok" : state === "err" ? "danger" : "neutral");
    icon.innerHTML = ui.icon(state === "ok" ? "check" : state === "err" ? "alert" : "server");
    $("check-title").textContent = title;
    $("check-detail").textContent = detail || "";
    $("check-acc").innerHTML = state === "loading" ? '<span class="spinner"></span>' : "";
}

async function checkServer() {
    const host = currentHost();
    const seq = ++checkSeq;
    if (!host) { setCheck("idle", "Informe o host do servidor", ""); return; }
    if (!/^https?:\/\//i.test(host)) { setCheck("err", "Host inválido", "Use https://seu-servidor"); return; }

    setCheck("loading", "Verificando o servidor…", host);
    const started = performance.now();
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(host + "/health", { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(t);
        if (seq !== checkSeq) return;
        if (!res.ok) throw new Error("HTTP " + res.status);
        const h = await res.json();
        const ms = Math.round(performance.now() - started);
        setCheck("ok", "Servidor online", `v${h.version ?? "?"} · ${h.transport ?? "?"} · ${ms} ms`);
    } catch (e) {
        if (seq !== checkSeq) return;
        setCheck("err", "Servidor inacessível", e && e.name === "AbortError" ? "sem resposta em 6 s" : host);
    }
}

function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkServer, 450);
}

api.defaults().then(d => {
    defaults = d;
    checkServer();
});

$("server-choice").addEventListener("change", e => {
    useOwn = e.detail.value === "own";
    $("host-wrap").hidden = !useOwn;
    if (useOwn) hostInput.focus();
    scheduleCheck();
});
hostInput.addEventListener("input", () => {
    hostInput.removeAttribute("aria-invalid");
    scheduleCheck();
});

// ------------------------------------------------------------------ aplicar
applyBtn.addEventListener("click", async () => {
    const host = currentHost();
    if (useOwn && !host) {
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

$("open-hub").addEventListener("click", () => api.openHub());
$("restart").addEventListener("click", () => {
    $("step-done").hidden = true;
    $("step-config").hidden = false;
    say("");
});
