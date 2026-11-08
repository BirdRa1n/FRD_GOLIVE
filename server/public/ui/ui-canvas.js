/* Componentes em <canvas> do design system (hub/admin/instalador). Sem build, sem dependências.
 *
 *   FRDCanvas.mount(canvas, "liveMap" | "gauge" | "area" | "heat" | "bars" | "link", data)
 *   FRDCanvas.set(canvas, data)        // troca os dados; a animação continua do estado atual
 *
 * Um laço único de requestAnimationFrame desenha só os canvas visíveis e para com a aba oculta.
 * Cores vêm dos tokens CSS do próprio canvas (nunca literais), então seguem o tema na hora.
 * Com prefers-reduced-motion o quadro é desenhado parado, só quando os dados ou o tema mudam. */
(function () {
    "use strict";

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var items = new Set();
    var running = false;

    function tok(el, name) { return getComputedStyle(el).getPropertyValue("--" + name).trim() || "#888"; }
    function alpha(c, a) {
        if (!c) return "rgba(128,128,128," + a + ")";
        if (c.indexOf("rgba(") === 0) return c.replace(/,\s*[\d.]+\)$/, "," + a + ")");
        if (c.indexOf("rgb(") === 0) return c.replace("rgb(", "rgba(").replace(")", "," + a + ")");
        if (c[0] !== "#") return c;
        var h = c.slice(1); if (h.length === 3) h = h.replace(/./g, "$&$&");
        var n = parseInt(h.slice(0, 6), 16);
        return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
    }
    function ease(x) { x = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - x, 3); }
    function rrect(c, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }
    function smooth(c, pts) {
        c.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) {
            var p = pts[i - 1], q = pts[i], mx = (p[0] + q[0]) / 2;
            c.bezierCurveTo(mx, p[1], mx, q[1], q[0], q[1]);
        }
    }
    function font(el, weight, size) {
        var f = getComputedStyle(el).getPropertyValue("--font").trim() || "system-ui, sans-serif";
        return weight + " " + size + "px " + f;
    }
    function since(it) { return performance.now() - it.t0; }
    function fmtMbps(kbps) { return (kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1).replace(".", ","); }

    var DRAW = {};

    /* Hub no centro, salas ao redor, pessoas em volta da sala. Pontos de luz saem de quem
       transmite, passam pelo hub e chegam a cada espectador da mesma sala. */
    DRAW.liveMap = function (c, w, h, t, it) {
        var el = it.el, d = it.data || {}, rooms = (d.rooms || []).slice(0, 8);
        var line = tok(el, "separator"), tx = tok(el, "text"), t3 = tok(el, "text-3"), live = tok(el, "live"),
            acc = tok(el, "accent"), surf = tok(el, "surface"), on = tok(el, "on-color");
        var cx = w / 2, cy = h / 2, k = ease(since(it) / 900);
        var rx = Math.min(w * 0.34, 200), ry = Math.min(h * 0.3, 120);
        if (rooms.length === 1) { rx *= 0.8; ry *= 0.8; }
        var nodes = rooms.map(function (r, i) {
            var a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, rooms.length) + (rooms.length > 1 ? 0.35 : 0);
            return { r: r, a: a, x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k };
        });
        function ctrl(n) { return [(cx + n.x) / 2 + (n.y - cy) * 0.25, (cy + n.y) / 2 - (n.x - cx) * 0.25]; }
        function bez(n, u) { var m = ctrl(n); return [(1 - u) * (1 - u) * cx + 2 * (1 - u) * u * m[0] + u * u * n.x, (1 - u) * (1 - u) * cy + 2 * (1 - u) * u * m[1] + u * u * n.y]; }

        nodes.forEach(function (n) {
            var m = ctrl(n);
            c.strokeStyle = line; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx, cy); c.quadraticCurveTo(m[0], m[1], n.x, n.y); c.stroke();
            var ppl = (n.r.members || []).slice(0, 9);
            n.pp = ppl.map(function (p, j) {
                var a = n.a + (j - (ppl.length - 1) / 2) * 0.55;
                return { p: p, x: n.x + Math.cos(a) * 40 * k, y: n.y + Math.sin(a) * 40 * k };
            });
            n.pp.forEach(function (q) { c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.moveTo(n.x, n.y); c.lineTo(q.x, q.y); c.stroke(); });
        });

        if (!reduce) nodes.forEach(function (n, ni) {
            var viewers = n.pp.filter(function (q) { return !q.p.streamer; });
            n.pp.filter(function (q) { return q.p.streamer; }).forEach(function (s, si) {
                for (var j = 0; j < 3; j++) {
                    var p = ((t / 2200) + j / 3 + ni * 0.21 + si * 0.13) % 1, x, y, col = live;
                    if (p < 0.2) { var u = p / 0.2; x = s.x + (n.x - s.x) * u; y = s.y + (n.y - s.y) * u; }
                    else if (p < 0.5) { var b = bez(n, 1 - (p - 0.2) / 0.3); x = b[0]; y = b[1]; }
                    else if (p < 0.8) { var b2 = bez(n, (p - 0.5) / 0.3); x = b2[0]; y = b2[1]; col = acc; }
                    else {
                        var u4 = (p - 0.8) / 0.2;
                        viewers.forEach(function (v) { c.fillStyle = acc; c.beginPath(); c.arc(n.x + (v.x - n.x) * u4, n.y + (v.y - n.y) * u4, 2.6, 0, 7); c.fill(); });
                        continue;
                    }
                    c.fillStyle = alpha(col, 0.25); c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill();
                    c.fillStyle = col; c.beginPath(); c.arc(x, y, 2.8, 0, 7); c.fill();
                }
            });
        });

        c.textAlign = "center";
        nodes.forEach(function (n) {
            rrect(c, n.x - 9, n.y - 9, 18, 18, 6); c.fillStyle = surf; c.fill(); c.strokeStyle = tx; c.lineWidth = 1.5; c.stroke();
            c.fillStyle = tx; c.font = font(el, 600, 11.5);
            var label = String(n.r.label || "sala"); if (label.length > 22) label = label.slice(0, 21) + "…";
            c.fillText(label, n.x, n.y + (n.y < cy ? -50 : 60));
            n.pp.forEach(function (q) {
                if (q.p.streamer && !reduce) {
                    var pu = (t / 1600) % 1;
                    c.strokeStyle = alpha(live, 0.5 * (1 - pu)); c.lineWidth = 2; c.beginPath(); c.arc(q.x, q.y, 7 + pu * 9, 0, 7); c.stroke();
                }
                c.fillStyle = q.p.streamer ? live : surf; c.strokeStyle = q.p.streamer ? live : t3; c.lineWidth = 1.5;
                c.beginPath(); c.arc(q.x, q.y, q.p.streamer ? 6 : 4.5, 0, 7); c.fill(); c.stroke();
            });
        });

        rrect(c, cx - 26, cy - 16, 52, 32, 11); c.fillStyle = acc; c.fill();
        c.fillStyle = on; c.font = font(el, 750, 12); c.textBaseline = "middle"; c.fillText("HUB", cx, cy + 1); c.textBaseline = "alphabetic";
        if (!rooms.length) { c.fillStyle = t3; c.font = font(el, 500, 13); c.fillText(d.empty || "Ninguém em call agora", cx, cy + 46); }
    };

    /* Semicírculo verde/âmbar/vermelho com ponteiro. data: { value, max, unit, good } */
    DRAW.gauge = function (c, w, h, t, it) {
        var el = it.el, d = it.data || {}, ok = tok(el, "ok"), wa = tok(el, "warn"), dg = tok(el, "danger"), tx = tok(el, "text"), t3 = tok(el, "text-3"), fill = tok(el, "fill-2");
        var max = d.max || 120, has = typeof d.value === "number", cx = w / 2, cy = h - 16, r = Math.max(10, Math.min(w / 2 - 10, h - 34)), k = ease(since(it) / 900);
        it.shown = it.shown === undefined ? 0 : it.shown;
        if (has) it.shown += (d.value - it.shown) * (reduce ? 1 : 0.12);
        c.lineCap = "round"; c.lineWidth = 10;
        if (!has) { c.strokeStyle = fill; c.beginPath(); c.arc(cx, cy, r, Math.PI, 0); c.stroke(); }
        else [[0, 0.33, ok], [0.36, 0.64, wa], [0.67, 1, dg]].forEach(function (z) {
            c.strokeStyle = alpha(z[2], 0.85); c.beginPath(); c.arc(cx, cy, r, Math.PI + z[0] * Math.PI, Math.PI + z[1] * Math.PI); c.stroke();
        });
        if (has) {
            var a = Math.PI + Math.min(1, it.shown / max) * Math.PI * k;
            c.strokeStyle = tx; c.lineWidth = 3; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16)); c.stroke();
            c.fillStyle = tx; c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.fill();
        }
        c.textAlign = "left"; c.fillStyle = tx; c.font = font(el, 750, 18);
        c.fillText(has ? Math.round(it.shown) + " " + (d.unit || "ms") : "—", 2, 18);
        c.textAlign = "right"; c.fillStyle = t3; c.font = font(el, 500, 11);
        c.fillText(has ? "bom < " + (d.good || 40) : "sem medição", w - 2, 16);
    };

    /* Área suave com gradiente. data: { values: kbps[], label } — exibe em Mb/s. */
    DRAW.area = function (c, w, h, t, it) {
        var el = it.el, d = it.data || {}, acc = tok(el, "accent"), grid = tok(el, "grid"), t3 = tok(el, "text-3");
        var vals = (d.values || []).slice(-720);
        var L = 2, R = 2, T = 12, B = 18;
        if (vals.length > 120) { // reduz para ~120 pontos (média por janela)
            var step = vals.length / 120, out = [];
            for (var i = 0; i < 120; i++) { var a = Math.floor(i * step), b = Math.floor((i + 1) * step), s = 0; for (var j = a; j < b; j++) s += vals[j]; out.push(s / Math.max(1, b - a)); }
            out[out.length - 1] = vals[vals.length - 1];
            vals = out;
        }
        var max = Math.max(2000, Math.max.apply(null, vals.concat([0])) * 1.25), k = ease(since(it) / 900);
        var gl = [0.25, 0.5, 0.75];
        c.strokeStyle = grid; c.lineWidth = 1;
        gl.forEach(function (g) { var y = T + (h - T - B) * (1 - g); c.beginPath(); c.moveTo(L, y); c.lineTo(w - R, y); c.stroke(); });
        c.fillStyle = t3; c.font = font(el, 500, 10.5); c.textAlign = "left";
        c.fillText(fmtMbps(max * 0.75) + " Mb/s", L + 2, T + (h - T - B) * 0.25 - 4);
        c.fillText(d.from || "−60 min", L, h - 3); c.textAlign = "right"; c.fillText("agora", w - R, h - 3);
        if (vals.length < 2) {
            c.textAlign = "center"; c.font = font(el, 500, 13); c.fillText(d.empty || "Coletando dados…", w / 2, h / 2);
            return;
        }
        var pts = vals.map(function (v, i) { return [L + (w - L - R) * i / (vals.length - 1), T + (h - T - B) * (1 - (v * k) / max)]; });
        var gr = c.createLinearGradient(0, T, 0, h - B); gr.addColorStop(0, alpha(acc, 0.28)); gr.addColorStop(1, alpha(acc, 0));
        c.beginPath(); smooth(c, pts); c.lineTo(w - R, h - B); c.lineTo(L, h - B); c.closePath(); c.fillStyle = gr; c.fill();
        c.beginPath(); smooth(c, pts); c.strokeStyle = acc; c.lineWidth = 2.5; c.stroke();
        var e = pts[pts.length - 1], pu = reduce ? 0 : (t / 1400) % 1;
        c.fillStyle = alpha(acc, 0.3 * (1 - pu)); c.beginPath(); c.arc(e[0] - 5, e[1], 5 + pu * 8, 0, 7); c.fill();
        c.fillStyle = acc; c.beginPath(); c.arc(e[0] - 5, e[1], 4.5, 0, 7); c.fill();
    };

    /* Canais × 24 horas. data: { hours: ts[], rows: [{ label, values: minutos[24] }] } */
    DRAW.heat = function (c, w, h, t, it) {
        var el = it.el, d = it.data || {}, acc = tok(el, "accent"), t2 = tok(el, "text-2"), t3 = tok(el, "text-3"), fill = tok(el, "fill");
        var rows = (d.rows || []).slice(0, 12), hours = d.hours || [];
        var L = Math.min(170, w * 0.32), T = 2, B = 18, R = 2, cw = (w - L - R) / 24, rh = rows.length ? Math.min(30, (h - T - B) / rows.length) : 0, k = since(it) / 25;
        c.font = font(el, 500, 12.5); c.textAlign = "left";
        if (!rows.length) { c.fillStyle = t3; c.textAlign = "center"; c.fillText(d.empty || "Sem transmissões nas últimas 24 h", w / 2, h / 2); return; }
        rows.forEach(function (r, i) {
            var y = T + i * rh, label = String(r.label); if (label.length > 26) label = label.slice(0, 25) + "…";
            c.fillStyle = t2; c.fillText(label, 2, y + rh / 2 + 4);
            for (var hh = 0; hh < 24; hh++) {
                var v = Math.min(1, (r.values[hh] || 0) / 60), vis = reduce ? 1 : Math.min(1, Math.max(0, (k - hh - i) / 6));
                c.fillStyle = v > 0 ? alpha(acc, (0.16 + v * 0.8) * vis) : fill;
                rrect(c, L + hh * cw + 1.5, y + 2, cw - 3, rh - 4, 5); c.fill();
            }
        });
        c.fillStyle = t3; c.font = font(el, 500, 10.5); c.textAlign = "center";
        [0, 6, 12, 18, 23].forEach(function (i) {
            if (!hours[i]) return;
            c.fillText(new Date(hours[i]).getHours() + "h", L + i * cw + cw / 2, T + rows.length * rh + 14);
        });
    };

    /* Barras empilhadas por hora. data: { hours: [{ t, info, warn, error }] } */
    DRAW.bars = function (c, w, h, t, it) {
        var el = it.el, d = it.data || {}, info = tok(el, "fill-2"), wa = tok(el, "warn"), dg = tok(el, "danger"), t3 = tok(el, "text-3");
        var hrs = d.hours || [], n = hrs.length || 24, L = 2, R = 2, T = 6, B = 18, bw = (w - L - R) / n;
        var max = Math.max(10, Math.max.apply(null, hrs.map(function (x) { return x.info + x.warn + x.error; }).concat([0])));
        hrs.forEach(function (x, i) {
            var k = reduce ? 1 : ease((since(it) - i * 30) / 600), sc = (h - T - B) / max * k, tot = (x.info + x.warn + x.error) * sc;
            if (tot <= 0) return;
            var bx = L + i * bw + 2, bwi = Math.max(2, bw - 4), y = h - B;
            c.save(); rrect(c, bx, y - tot, bwi, tot, 5); c.clip();
            c.fillStyle = info; c.fillRect(bx, y - x.info * sc, bwi, x.info * sc);
            c.fillStyle = wa; c.fillRect(bx, y - (x.info + x.warn) * sc, bwi, x.warn * sc);
            c.fillStyle = dg; c.fillRect(bx, y - tot, bwi, x.error * sc);
            c.restore();
        });
        c.fillStyle = t3; c.font = font(el, 500, 10.5); c.textAlign = "center";
        [0, 6, 12, 18].forEach(function (i) { if (hrs[i]) c.fillText(String(new Date(hrs[i].t).getHours()).padStart(2, "0") + "h", L + i * bw + bw / 2, h - 4); });
        c.textAlign = "right"; c.fillText("agora", w - R, h - 4);
        if (!hrs.some(function (x) { return x.info + x.warn + x.error; })) { c.textAlign = "center"; c.font = font(el, 500, 13); c.fillText(d.empty || "Nenhum log nas últimas 24 h", w / 2, (h - B) / 2); }
    };

    /* Instalador: seu computador ↔ servidor. data: { state: idle|checking|ok|err|applying|done } */
    DRAW.link = function (c, w, h, t, it) {
        var el = it.el, st = (it.data && it.data.state) || "idle", on = tok(el, "on-color"), ok = tok(el, "ok"), dg = tok(el, "danger");
        var y = h / 2 - 8, x1 = w * 0.2, x2 = w * 0.8, solid = st === "ok" || st === "applying" || st === "done";
        c.strokeStyle = alpha(on, solid ? 0.9 : 0.45); c.lineWidth = 2.5;
        c.setLineDash(solid ? [] : [5, 6]); c.lineDashOffset = reduce ? 0 : -t / 40;
        c.beginPath(); c.moveTo(x1 + 44, y); c.lineTo(x2 - 34, y); c.stroke(); c.setLineDash([]);
        if (!reduce && st !== "idle" && st !== "err") {
            var speed = st === "applying" ? 900 : 1600;
            for (var p = 0; p < 3; p++) {
                var u = ((t / speed) + p / 3) % 1, px = x1 + 44 + (x2 - x1 - 78) * u;
                c.fillStyle = alpha(on, Math.sin(u * Math.PI)); c.beginPath(); c.arc(px, y, 4, 0, 7); c.fill();
            }
        }
        c.strokeStyle = on; c.lineWidth = 2; c.fillStyle = alpha(on, 0.12);
        rrect(c, x1 - 30, y - 22, 60, 38, 7); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(x1 - 40, y + 22); c.lineTo(x1 + 40, y + 22); c.stroke();
        for (var i = 0; i < 3; i++) {
            c.fillStyle = alpha(on, 0.12); rrect(c, x2 - 26, y - 30 + i * 20, 52, 16, 5); c.fill(); c.stroke();
            c.fillStyle = alpha(on, 0.9); c.beginPath(); c.arc(x2 + 16, y - 22 + i * 20, 2.2, 0, 7); c.fill();
        }
        c.fillStyle = alpha(on, 0.92); c.font = font(el, 600, 12); c.textAlign = "center";
        c.fillText("Seu computador", x1, y + 46); c.fillText("Servidor", x2, y + 46);
        if (st === "done" || st === "ok" || st === "err") {
            var k = reduce ? 1 : ease((performance.now() - (it.stateAt || 0)) / 500), mx = w / 2, my = y - 34;
            c.fillStyle = st === "err" ? dg : ok; c.beginPath(); c.arc(mx, my, 14 * k, 0, 7); c.fill();
            c.strokeStyle = on; c.lineWidth = 2.5; c.lineCap = "round"; c.beginPath();
            if (st === "err") { c.moveTo(mx - 5, my - 5); c.lineTo(mx + 5, my + 5); c.moveTo(mx + 5, my - 5); c.lineTo(mx - 5, my + 5); }
            else { c.moveTo(mx - 6, my); c.lineTo(mx - 1, my + 5); c.lineTo(mx + 7, my - 5); }
            c.stroke(); c.lineCap = "butt";
        }
    };

    function draw(it, t) {
        var cv = it.el, w = cv.clientWidth, h = cv.clientHeight;
        if (!w || !h) return;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        var c = cv.getContext("2d");
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);
        try { DRAW[it.kind](c, w, h, t, it); } catch (e) { console.error("[ui-canvas]", it.kind, e); }
    }

    function frame(t) {
        running = false;
        if (document.hidden) return;
        items.forEach(function (it) {
            if (!it.el.isConnected) { items.delete(it); return; }
            if (it.el.offsetParent !== null) draw(it, t);
        });
        if (!reduce && items.size) { running = true; requestAnimationFrame(frame); }
    }
    function kick() {
        if (reduce) { requestAnimationFrame(frame); return; }
        if (!running) { running = true; requestAnimationFrame(frame); }
    }

    function find(cv) { var hit = null; items.forEach(function (it) { if (it.el === cv) hit = it; }); return hit; }

    function mount(cv, kind, data) {
        if (!cv || !DRAW[kind]) return;
        var it = find(cv);
        if (!it) { it = { el: cv, kind: kind, t0: performance.now() }; items.add(it); }
        it.kind = kind;
        set(cv, data);
    }
    function set(cv, data) {
        var it = find(cv); if (!it) return;
        var prev = it.data && it.data.state;
        it.data = data || {};
        if (it.data.state !== prev) it.stateAt = performance.now();
        kick();
    }
    /** Reinicia a animação de entrada (ex.: ao trocar de aba). */
    function replay(scope) {
        var now = performance.now();
        items.forEach(function (it) { if (!scope || scope.contains(it.el)) it.t0 = now; });
        kick();
    }

    document.addEventListener("visibilitychange", kick);
    window.addEventListener("resize", kick);
    new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (window.matchMedia) {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        if (mq.addEventListener) mq.addEventListener("change", kick);
    }

    window.FRDCanvas = { mount: mount, set: set, replay: replay, kinds: Object.keys(DRAW) };
})();
