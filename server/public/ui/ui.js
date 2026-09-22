/*
 * FRD GoLive — design system (fase 1): comportamento dos componentes.
 *
 * Script clássico (sem build), expõe `window.FRDUI`. Carregue no <head> SEM
 * defer: ele aplica o tema salvo antes da primeira pintura (sem flash) e liga
 * os componentes quando o DOM fica pronto — inclusive os inseridos depois
 * (MutationObserver), então páginas que renderizam via innerHTML funcionam.
 *
 * Marcação esperada: ver /ui/ (public/ui/index.html).
 */
(function () {
    "use strict";

    var root = document.documentElement;
    var THEME_KEY = "frd-theme";
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ------------------------------------------------------------------ tema
    function storedTheme() {
        try {
            var t = localStorage.getItem(THEME_KEY);
            return t === "light" || t === "dark" ? t : "system";
        } catch (e) {
            return "system";
        }
    }

    function writeTheme(t) {
        if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
        else root.removeAttribute("data-theme");
        try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ok */ }
    }

    /** Troca o tema com revelação circular a partir de (x, y) quando suportado. */
    function setTheme(t, origin) {
        if (!document.startViewTransition || reduceMotion) {
            writeTheme(t);
            return;
        }
        var x = origin && origin.x ? origin.x : window.innerWidth - 60;
        var y = origin && origin.y ? origin.y : 30;
        var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        var vt = document.startViewTransition(function () { writeTheme(t); });
        vt.ready.then(function () {
            root.animate(
                { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + r + "px at " + x + "px " + y + "px)"] },
                { duration: 650, easing: "cubic-bezier(.22,.8,.26,1)", pseudoElement: "::view-transition-new(root)" }
            );
        }).catch(function () { /* ok */ });
    }

    writeTheme(storedTheme()); // antes da primeira pintura

    // ------------------------------------------------------------ segmented
    function placeThumb(seg) {
        var on = seg.querySelector(':scope > button[aria-pressed="true"]');
        var th = seg.querySelector(":scope > .segmented-thumb");
        if (!th) return;
        if (!on || !on.offsetWidth) { th.style.opacity = "0"; return; } // oculto (ex.: sheet fechado)
        // Primeira vez visível: posiciona sem animar (senão desliza a partir do canto).
        var first = th.style.opacity !== "1";
        if (first) th.style.transition = "none";
        th.style.opacity = "1";
        th.style.left = on.offsetLeft + "px";
        th.style.top = on.offsetTop + "px";
        th.style.width = on.offsetWidth + "px";
        th.style.height = on.offsetHeight + "px";
        if (first) { void th.offsetWidth; th.style.transition = ""; }
    }

    function selectSegment(seg, btn, silent) {
        seg.querySelectorAll(":scope > button").forEach(function (b) {
            b.setAttribute("aria-pressed", String(b === btn));
        });
        placeThumb(seg);
        if (!silent) seg.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: btn.dataset.value } }));
    }

    function initSegmented(seg) {
        if (seg.classList.contains("is-ready")) return;
        var th = document.createElement("span");
        th.className = "segmented-thumb";
        th.setAttribute("aria-hidden", "true");
        seg.prepend(th);
        seg.classList.add("is-ready");
        seg.setAttribute("role", seg.getAttribute("role") || "group");

        // seletor de tema pronto: <div class="segmented" data-theme-switch>
        if (seg.hasAttribute("data-theme-switch")) {
            var current = storedTheme();
            seg.querySelectorAll(":scope > button").forEach(function (b) {
                b.setAttribute("aria-pressed", String(b.dataset.value === current));
            });
            seg.addEventListener("change", function (e) {
                setTheme(e.detail.value, lastPointer);
            });
        }
        // Reposiciona quando o tamanho muda — inclusive ao sair de display:none
        // (sheet abrindo, aba trocando), quando os offsets passam a existir.
        if (window.ResizeObserver) new ResizeObserver(function () { placeThumb(seg); }).observe(seg);
        requestAnimationFrame(function () { placeThumb(seg); });
    }

    var lastPointer = null;

    // ------------------------------------------------------------------ sheet
    function openSheet(dialog) {
        if (typeof dialog === "string") dialog = document.querySelector(dialog);
        if (!dialog || dialog.open) return;
        dialog.showModal();
        var focus = dialog.querySelector("[autofocus]") || dialog.querySelector(".sheet-body input, .sheet-body button");
        if (focus) focus.focus();
    }

    function closeSheet(dialog, value) {
        if (typeof dialog === "string") dialog = document.querySelector(dialog);
        if (dialog && dialog.open) dialog.close(value);
    }

    function initSheet(dialog) {
        if (dialog.dataset.uiReady) return;
        dialog.dataset.uiReady = "1";
        // clique no backdrop fecha
        dialog.addEventListener("click", function (e) {
            if (e.target === dialog) closeSheet(dialog, "cancel");
        });
    }

    // ------------------------------------------------------------------ toast
    var region = null;

    function toast(message, tone, ms) {
        if (!region) {
            region = document.createElement("div");
            region.className = "toast-region";
            region.setAttribute("role", "status");
            region.setAttribute("aria-live", "polite");
            document.body.appendChild(region);
        }
        var el = document.createElement("div");
        el.className = "toast" + (tone ? " " + tone : "");
        el.textContent = message;
        region.appendChild(el);
        setTimeout(function () {
            el.classList.add("leaving");
            el.addEventListener("animationend", function () { el.remove(); }, { once: true });
            setTimeout(function () { el.remove(); }, 600);
        }, ms || 3200);
    }

    // ---------------------------------------------------------------- confirm
    /**
     * Confirmação em sheet (substitui window.confirm).
     * FRDUI.confirm({ title, message, confirmLabel, destructive }) → Promise<boolean>
     */
    function confirmSheet(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var d = document.createElement("dialog");
            d.className = "sheet";
            d.innerHTML =
                '<div class="sheet-body">' +
                '<h2 class="title"></h2><p class="subhead"></p>' +
                "</div>" +
                '<div class="sheet-footer">' +
                '<button class="btn" value="cancel">Cancelar</button>' +
                '<button class="btn ' + (opts.destructive ? "btn-destructive btn-filled" : "btn-prominent") + '" value="ok"></button>' +
                "</div>";
            d.querySelector(".title").textContent = opts.title || "Tem certeza?";
            d.querySelector(".subhead").textContent = opts.message || "";
            d.querySelector('[value="ok"]').textContent = opts.confirmLabel || "Confirmar";
            d.querySelectorAll(".sheet-footer button").forEach(function (b) {
                b.addEventListener("click", function () { d.close(b.value); });
            });
            d.addEventListener("close", function () {
                resolve(d.returnValue === "ok");
                setTimeout(function () { d.remove(); }, 400);
            });
            document.body.appendChild(d);
            initSheet(d);
            openSheet(d);
            d.querySelector('[value="ok"]').focus();
        });
    }

    // -------------------------------------------------------------- helpers
    /** SVG de sparkline (herda `color`). */
    function sparkline(values, opts) {
        opts = opts || {};
        var w = 100, h = 30, pad = 3;
        var vals = (values || []).filter(function (v) { return typeof v === "number" && isFinite(v); });
        if (vals.length < 2) vals = [0, 0];
        var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
        if (opts.min !== undefined) min = Math.min(min, opts.min);
        if (opts.max !== undefined) max = Math.max(max, opts.max);
        var span = max - min || 1;
        var pts = vals.map(function (v, i) {
            return [(i * w) / (vals.length - 1), h - pad - ((v - min) / span) * (h - pad * 2)];
        });
        var line = pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
        var id = "sg" + Math.random().toString(36).slice(2, 8);
        var last = pts[pts.length - 1];
        return '<svg class="sparkline" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".3"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
            '<polygon points="0,' + h + " " + line + " " + w + "," + h + '" fill="url(#' + id + ')"/>' +
            '<polyline points="' + line + '" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>' +
            '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.4" fill="currentColor"/></svg>';
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    /** "agora", "há 5 min", "há 2 h", "há 3 dias". */
    function relativeTime(ts) {
        if (!ts) return "—";
        var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (s < 45) return "agora";
        var m = Math.round(s / 60);
        if (m < 60) return "há " + m + " min";
        var h = Math.round(m / 60);
        if (h < 24) return "há " + h + " h";
        var d = Math.round(h / 24);
        return "há " + d + (d === 1 ? " dia" : " dias");
    }

    /** "00:12:44" a partir de segundos. */
    function duration(sec) {
        sec = Math.max(0, Math.floor(sec));
        return [sec / 3600 | 0, (sec / 60 | 0) % 60, sec % 60].map(function (n) {
            return String(n).padStart(2, "0");
        }).join(":");
    }

    /** Iniciais para avatar. */
    function initials(name) {
        var parts = String(name || "?").replace(/[._-]+/g, " ").trim().split(/\s+/);
        return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : (parts[0][1] || ""))).toUpperCase();
    }

    // ------------------------------------------------------------ delegação
    document.addEventListener("pointerdown", function (e) {
        lastPointer = { x: e.clientX, y: e.clientY };
    }, true);

    document.addEventListener("click", function (e) {
        var t = e.target;
        if (!(t instanceof Element)) return;

        var segBtn = t.closest(".segmented > button");
        if (segBtn && segBtn.getAttribute("aria-pressed") !== "true") {
            if (!e.detail) lastPointer = null; // teclado: revela do canto
            selectSegment(segBtn.parentElement, segBtn);
            return;
        }

        var sw = t.closest('.toggle[role="switch"]');
        if (sw && !sw.disabled && !sw.hasAttribute("data-manual")) {
            var on = sw.getAttribute("aria-checked") !== "true";
            sw.setAttribute("aria-checked", String(on));
            sw.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { checked: on } }));
            return;
        }

        var card = t.closest('.choice-card[role="radio"]');
        if (card) {
            var group = card.closest('[role="radiogroup"]');
            if (group) {
                group.querySelectorAll('.choice-card[role="radio"]').forEach(function (c) {
                    c.setAttribute("aria-checked", String(c === card));
                });
                group.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: card.dataset.value } }));
            }
            return;
        }

        var opener = t.closest("[data-sheet-open]");
        if (opener) { openSheet(opener.getAttribute("data-sheet-open")); return; }

        var closer = t.closest("[data-sheet-close]");
        if (closer) { closeSheet(closer.closest("dialog"), closer.getAttribute("data-sheet-close") || "cancel"); }
    });

    // setas no segmented
    document.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        var btn = e.target instanceof Element && e.target.closest(".segmented > button");
        if (!btn) return;
        var all = Array.prototype.slice.call(btn.parentElement.querySelectorAll(":scope > button"));
        var next = all[(all.indexOf(btn) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
        next.focus();
        lastPointer = null;
        selectSegment(btn.parentElement, next);
        e.preventDefault();
    });


    // ------------------------------------------------------------------ ícones
    // SVGs 24×24 com currentColor. Uso: <i data-icon="check"></i> (hidratado no
    // init) ou FRDUI.icon("check") em markup gerado por JS.
    var ICONS = {
        logo: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H13l1 3h1.5a1 1 0 1 1 0 2h-7a1 1 0 1 1 0-2H10l1-3H6.5A2.5 2.5 0 0 1 4 13.5v-7Zm6 1.8v4.4c0 .5.5.8.9.5l3.4-2.2a.6.6 0 0 0 0-1L10.9 7.8c-.4-.3-.9 0-.9.5Z"/>',
        check: '<path d="M9.5 16.2 5.8 12.5l-1.4 1.4 5.1 5.1L20 8.5l-1.4-1.4z"/>',
        clock: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z"/>',
        shield: '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z"/>',
        lock: '<path d="M12 2a5 5 0 0 1 5 5v2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3Z"/>',
        monitor: '<path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3v2H8v-2h3v-2H5a2 2 0 0 1-2-2V5Z"/>',
        camera: '<path d="M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.5l4.2-2.6c.7-.4 1.8.1 1.8.9v10.4c0 .8-1.1 1.3-1.8.9L16 15.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
        mic: '<path d="M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-7 9h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-2.1A7 7 0 0 1 5 12Z"/>',
        live: '<circle cx="12" cy="12" r="4"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2l1.4-1.4a8 8 0 0 1 0-11.4zM19.1 4.9l-1.4 1.4a8 8 0 0 1 0 11.4l1.4 1.4a10 10 0 0 0 0-14.2Z"/>',
        users: '<path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 4.5V20h14v-1.5C16 16 13 14 9 14Zm7.5-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm.5 2h-.3A5.4 5.4 0 0 1 18 18.5V20h4v-1.5C22 16 19.8 14 17 14Z"/>',
        user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z"/>',
        inbox: '<path d="M4 4h16v12H7l-3 3V4Z"/>',
        chart: '<path d="M4 19h16v2H4zM5 10h3v7H5zm5.5-5h3v12h-3zM16 13h3v4h-3z"/>',
        doc: '<path d="M6 2h9l5 5v15H6V2Zm8 1.5V8h4.5L14 3.5ZM8 12h10v2H8zm0 4h10v2H8z"/>',
        server: '<path d="M4 4h16v6H4V4Zm0 10h16v6H4v-6Zm3-8v2h2V6H7Zm0 10v2h2v-2H7Z"/>',
        logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm6.6 4.4-1.4 1.4 2.2 2.2H9v2h8.4l-2.2 2.2 1.4 1.4L21.2 12l-4.6-4.6Z"/>',
        download: '<path d="M11 3h2v9.6l3.3-3.3 1.4 1.4L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.3V3ZM4 19h16v2H4z"/>',
        plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
        x: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/>',
        alert: '<path d="M12 2 1 21h22L12 2Zm1 15h-2v-2h2v2Zm0-4h-2V9h2v4Z"/>',
        info: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 8h-2v7h2v-7Zm0-4h-2v2h2V6Z"/>',
        arrowRight: '<path d="M13.2 5.6 19.6 12l-6.4 6.4-1.4-1.4 4-4H4v-2h11.8l-4-4 1.4-1.4Z"/>',
        arrowLeft: '<path d="M10.8 5.6 4.4 12l6.4 6.4 1.4-1.4-4-4H20v-2H8.2l4-4-1.4-1.4Z"/>',
        settings: '<path d="m19.4 13 .1-1-.1-1 2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 2.7a7 7 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11l-.1 1 .1 1-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/>',
        sparkle: '<path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2Zm7 12 1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1 1-2.6Z"/>',
        discord: '<path d="M19.3 5.3A16.5 16.5 0 0 0 15.2 4l-.5 1a15 15 0 0 0-5.4 0L8.8 4a16.5 16.5 0 0 0-4.1 1.3C2 9.2 1.3 13 1.6 16.7a16.6 16.6 0 0 0 5 2.6l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a11.8 11.8 0 0 0 11.2 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a16.5 16.5 0 0 0 5-2.6c.4-4.3-.7-8-3.1-11.4ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/>',
    };

    function icon(name) {
        var path = ICONS[name];
        return path ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + path + "</svg>" : "";
    }

    function hydrateIcons(scope) {
        scope.querySelectorAll("[data-icon]").forEach(function (el) {
            if (el.firstElementChild) return;
            el.innerHTML = icon(el.getAttribute("data-icon"));
        });
    }

    // ------------------------------------------------------------------ init
    function init(scope) {
        scope = scope || document;
        scope.querySelectorAll(".segmented").forEach(initSegmented);
        scope.querySelectorAll("dialog.sheet").forEach(initSheet);
        hydrateIcons(scope);
    }

    function boot() {
        init(document);
        new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                for (var j = 0; j < records[i].addedNodes.length; j++) {
                    var n = records[i].addedNodes[j];
                    if (n.nodeType !== 1) continue;
                    if (n.matches(".segmented, dialog.sheet, [data-icon]")) init(n.parentElement || document);
                    else if (n.querySelector(".segmented, dialog.sheet, [data-icon]")) init(n);
                }
            }
        }).observe(document.body, { childList: true, subtree: true });

        window.addEventListener("resize", function () {
            document.querySelectorAll(".segmented.is-ready").forEach(placeThumb);
        });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                document.querySelectorAll(".segmented.is-ready").forEach(placeThumb);
            });
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();

    window.FRDUI = {
        getTheme: storedTheme,
        setTheme: setTheme,
        init: init,
        select: function (seg, value) {
            var b = seg.querySelector(':scope > button[data-value="' + value + '"]');
            if (b) selectSegment(seg, b, true);
        },
        openSheet: openSheet,
        closeSheet: closeSheet,
        toast: toast,
        confirm: confirmSheet,
        sparkline: sparkline,
        escapeHtml: escapeHtml,
        relativeTime: relativeTime,
        duration: duration,
        initials: initials,
        icon: icon,
        icons: Object.keys(ICONS),
    };
})();
