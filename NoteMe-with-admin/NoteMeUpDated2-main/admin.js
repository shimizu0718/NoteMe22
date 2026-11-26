// ========================================
// NOTEME ADMIN DASHBOARD
// Orders live in localStorage (same keys the storefront writes);
// customers come from MySQL via admin-users.php.
// ========================================
(function () {
    const ORDERS_KEY = "notemeOrders";
    const CUSTOM_KEY = "notemeCustomRequests";
    const $ = id => document.getElementById(id);

    const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[c]);
    const peso = n => "₱" + Number(n || 0).toLocaleString("en-PH");
    const load = k => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; } };
    const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

    const STATUS_LABEL = { pending: "Pending", progress: "In progress", delivered: "Delivered" };
    const TYPE_LABEL = { template: "Ready-made", customization: "Customization" };

    let orders = [];
    let users = null;           // null = not loaded, [] = loaded, "error" = failed
    let statusFilter = "all";
    let typeFilter = "all";
    let query = "";
    let userQuery = "";
    let openId = null;

    // ---------- DATA ----------
    function normStatus(s) {
        s = String(s || "pending").toLowerCase();
        if (s.includes("deliver")) return "delivered";
        if (s.includes("progress")) return "progress";
        return "pending";
    }

    function toDate(v) {
        if (!v) return null;
        const d = new Date(v);
        return isNaN(d) ? null : d;
    }

    function normalize(raw, type, src, idx) {
        const items = Array.isArray(raw.items) ? raw.items : [];
        const itemsTotal = items.reduce((s, i) => s + Number(i.price || 0) * Number(i.qty || 1), 0);
        const amount = type === "customization"
            ? Number(raw.startingPrice || 0)
            : Number(raw.total ?? itemsTotal);
        return {
            uid: src + ":" + (raw.id || "idx" + idx),
            src, idx,
            id: raw.id || (type === "customization" ? "Custom request #" + (idx + 1) : "Order #" + (idx + 1)),
            hasId: Boolean(raw.id),
            type,
            status: normStatus(raw.status),
            customer: raw.name || (type === "customization" ? "—" : "Unknown"),
            address: raw.address || "",
            payment: raw.payment || "",
            items,
            template: raw.template || "",
            palette: raw.palette || "",
            notes: raw.notes || "",
            amount,
            created: toDate(raw.createdAt || raw.date),
            createdText: raw.createdAt || raw.date || "",
            confirmed: toDate(raw.confirmedAt),
            completed: toDate(raw.completedAt)
        };
    }

    function refreshOrders() {
        const a = load(ORDERS_KEY).map((o, i) => normalize(o, "template", ORDERS_KEY, i));
        const b = load(CUSTOM_KEY).map((o, i) => normalize(o, "customization", CUSTOM_KEY, i));
        orders = [...a, ...b].sort((x, y) => (y.created || 0) - (x.created || 0));
    }

    // Write a change back to the same record the storefront reads.
    function mutate(order, fn) {
        const list = load(order.src);
        let i = order.hasId ? list.findIndex(o => o.id === order.id) : order.idx;
        if (i < 0 || !list[i]) return false;
        const result = fn(list[i], list);
        save(order.src, result === "remove" ? list.filter((_, n) => n !== i) : list);
        return true;
    }

    function setStatus(order, status) {
        const nowIso = new Date().toISOString();
        mutate(order, o => {
            o.status = status;
            if (status === "pending") { o.confirmedAt = null; o.completedAt = null; }
            if (status === "progress") { o.confirmedAt = o.confirmedAt || nowIso; o.completedAt = null; }
            if (status === "delivered") { o.confirmedAt = o.confirmedAt || nowIso; o.completedAt = nowIso; }
        });
        toast(`${order.id} → ${STATUS_LABEL[status]}`);
        rerender();
    }

    function removeOrder(order) {
        if (!confirm(`Delete ${order.id}? This cannot be undone.`)) return;
        mutate(order, () => "remove");
        closeDrawer();
        toast("Order deleted");
        rerender();
    }

    // ---------- FORMAT ----------
    const fmtDate = d => d ? d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—";
    const fmtDateTime = d => d ? d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "—";
    const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
    const summary = o => o.type === "customization"
        ? `${esc(o.template || "Custom design")} <span class="sub">${esc(o.palette)}</span>`
        : (o.items.length
            ? `${esc(o.items[0].name)}${o.items.length > 1 ? ` <span class="sub">+${o.items.length - 1} more</span>` : ` <span class="sub">× ${Number(o.items[0].qty || 1)}</span>`}`
            : "—");

    function toast(msg) {
        const t = $("toast");
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(toast.t);
        toast.t = setTimeout(() => t.classList.remove("show"), 2200);
    }

    // ---------- OVERVIEW ----------
    function hbars(rows) {
        const max = Math.max(1, ...rows.map(r => r.n));
        return rows.map(r => `
            <div class="hbar">
                <div><span>${esc(r.label)}</span><b>${r.n}</b></div>
                <div class="track"><div class="fill ${r.cls}" style="width:${(r.n / max) * 100}%"></div></div>
            </div>`).join("");
    }

    function renderOverview() {
        const by = s => orders.filter(o => o.status === s);
        const earned = by("delivered").reduce((s, o) => s + o.amount, 0);
        const pipeline = orders.filter(o => o.status !== "delivered").reduce((s, o) => s + o.amount, 0);
        const custCount = users === null || users === "error" ? "—" : users.filter(u => u.role === "customer").length;

        $("kpis").innerHTML = [
            ["Revenue (delivered)", peso(earned), "", ""],
            ["In pipeline", peso(pipeline), "pending + in progress", ""],
            ["Total orders", orders.length, "", ""],
            ["Pending", by("pending").length, "awaiting confirmation", by("pending").length ? "hot" : ""],
            ["In progress", by("progress").length, "", ""],
            ["Customers", custCount, "registered accounts", ""]
        ].map(([l, v, s, c]) => `<div class="kpi ${c}"><p>${l}</p><h3>${v}</h3>${s ? `<small>${s}</small>` : ""}</div>`).join("");

        // 14-day trend
        const days = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ d, n: 0 }); }
        orders.forEach(o => {
            if (!o.created) return;
            const k = new Date(o.created); k.setHours(0, 0, 0, 0);
            const slot = days.find(x => x.d.getTime() === k.getTime());
            if (slot) slot.n++;
        });
        const max = Math.max(1, ...days.map(d => d.n));
        $("trendTotal").textContent = days.reduce((s, d) => s + d.n, 0) + " orders";
        $("trend").innerHTML = days.map(({ d, n }) => `
            <div class="col" title="${fmtDate(d)}: ${n}">
                <div class="bar ${n ? "" : "zero"}" style="height:${n ? Math.max(6, (n / max) * 140) : 3}px">${n ? `<span>${n}</span>` : ""}</div>
                <small>${d.getDate()}/${d.getMonth() + 1}</small>
            </div>`).join("");

        $("statusBars").innerHTML = hbars(["pending", "progress", "delivered"].map(s => ({ label: STATUS_LABEL[s], n: by(s).length, cls: "c-" + s })));
        $("typeBars").innerHTML = hbars(["template", "customization"].map(t => ({ label: TYPE_LABEL[t], n: orders.filter(o => o.type === t).length, cls: "c-" + t })));

        const waiting = by("pending").slice(0, 5);
        $("attention").innerHTML = waiting.length ? waiting.map(o => `
            <div class="att">
                <div class="grow"><b>${esc(o.customer)} · ${esc(o.id)}</b><span class="sub">${esc(TYPE_LABEL[o.type])} · ${fmtDate(o.created)} · ${peso(o.amount)}</span></div>
                <button class="btn sm" data-act="progress" data-uid="${esc(o.uid)}">Confirm</button>
                <button class="btn sm outline" data-open="${esc(o.uid)}">Details</button>
            </div>`).join("") : `<div class="empty">All caught up — nothing is waiting for confirmation. ✦</div>`;
    }

    // ---------- ORDERS ----------
    function filteredOrders() {
        const q = query.trim().toLowerCase();
        return orders.filter(o =>
            (statusFilter === "all" || o.status === statusFilter) &&
            (typeFilter === "all" || o.type === typeFilter) &&
            (!q || [o.id, o.customer, o.template, o.palette, o.payment, ...o.items.map(i => i.name)].join(" ").toLowerCase().includes(q)));
    }

    function actionButtons(o) {
        if (o.status === "pending") return `<button class="btn sm" data-act="progress" data-uid="${esc(o.uid)}">Confirm</button>`;
        if (o.status === "progress") return `<button class="btn sm mint" data-act="delivered" data-uid="${esc(o.uid)}">Mark delivered</button>`;
        return "";
    }

    function renderOrders() {
        document.querySelectorAll("#statusTabs button").forEach(b => {
            const s = b.dataset.status;
            b.querySelector("span").textContent = s === "all" ? orders.length : orders.filter(o => o.status === s).length;
            b.classList.toggle("active", s === statusFilter);
        });
        const list = filteredOrders();
        $("ordersTable").innerHTML = list.length ? `
            <table>
                <thead><tr><th>Order</th><th>Customer</th><th>Details</th><th>Type</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
                <tbody>${list.map(o => `
                    <tr class="click" data-open="${esc(o.uid)}">
                        <td><span class="id">${esc(o.id)}</span><span class="sub">${fmtDate(o.created)}</span></td>
                        <td>${esc(o.customer)}</td>
                        <td>${summary(o)}</td>
                        <td>${pill(o.type, TYPE_LABEL[o.type])}</td>
                        <td class="num">${peso(o.amount)}</td>
                        <td>${pill(o.status, STATUS_LABEL[o.status])}</td>
                        <td class="num">${actionButtons(o)}</td>
                    </tr>`).join("")}</tbody>
            </table>` : `<div class="empty">${orders.length ? "No orders match these filters." : "No orders yet. They'll show up here once customers check out."}</div>`;

        const p = orders.filter(o => o.status === "pending").length;
        $("navPending").hidden = !p;
        $("navPending").textContent = p;
    }

    // ---------- DRAWER ----------
    function openDrawer(uid) {
        const o = orders.find(x => x.uid === uid);
        if (!o) return;
        openId = uid;
        const rows = [
            ["Customer", esc(o.customer)],
            o.address && ["Address", esc(o.address)],
            o.payment && ["Payment", esc(o.payment)],
            ["Submitted", fmtDateTime(o.created) !== "—" ? fmtDateTime(o.created) : esc(o.createdText || "—")],
            ["Confirmed", fmtDateTime(o.confirmed)],
            ["Delivered", fmtDateTime(o.completed)]
        ].filter(Boolean);

        let body = "";
        if (o.type === "customization") {
            body = `<h3>Request</h3><ul class="lines">
                <li><span>Template</span><span>${esc(o.template || "—")}</span></li>
                <li><span>Palette</span><span>${esc(o.palette || "—")}</span></li>
                <li><span>Notes</span><span>${esc(o.notes || "None")}</span></li>
                <li><span>Starting price</span><b>${peso(o.amount)}</b></li></ul>`;
        } else {
            body = `<h3>Items</h3><ul class="lines">${o.items.map(i =>
                `<li><span>${esc(i.name)} × ${Number(i.qty || 1)}</span><span>${peso(Number(i.price || 0) * Number(i.qty || 1))}</span></li>`).join("")
                || `<li><span>No items recorded</span></li>`}
                <li><b>Total</b><b>${peso(o.amount)}</b></li></ul>`;
        }

        const moves = [];
        if (o.status === "pending") moves.push(`<button class="btn" data-act="progress" data-uid="${esc(uid)}">Confirm order</button>`);
        if (o.status === "progress") moves.push(`<button class="btn mint" data-act="delivered" data-uid="${esc(uid)}">Mark delivered</button>`);
        if (o.status !== "pending") moves.push(`<button class="btn outline" data-act="pending" data-uid="${esc(uid)}">Back to pending</button>`);
        moves.push(`<button class="btn danger" data-act="delete" data-uid="${esc(uid)}">Delete</button>`);

        $("drawer").innerHTML = `
            <button class="close" data-close aria-label="Close">×</button>
            <span class="id">${esc(o.id)}</span>
            <h2>${esc(TYPE_LABEL[o.type])}</h2>
            ${pill(o.status, STATUS_LABEL[o.status])}
            <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
            ${body}
            <div class="actions">${moves.join("")}</div>`;
        $("drawer").hidden = false;
        $("scrim").hidden = false;
    }

    function closeDrawer() {
        openId = null;
        $("drawer").hidden = true;
        $("scrim").hidden = true;
    }

    // ---------- CUSTOMERS ----------
    async function loadUsers() {
        try {
            const res = await fetch("admin-users.php", { credentials: "same-origin" });
            const data = await res.json();
            users = res.ok && data.ok ? data.users : "error";
        } catch { users = "error"; }
        renderUsers();
        renderOverview();
    }

    function renderUsers() {
        const el = $("usersTable");
        if (users === null) { el.innerHTML = `<div class="empty">Loading…</div>`; return; }
        if (users === "error") { el.innerHTML = `<div class="empty">Couldn't load customers. Make sure PHP/MySQL is running and admin-users.php is uploaded.</div>`; return; }
        const q = userQuery.trim().toLowerCase();
        const list = users.filter(u => !q || [u.name, u.username, u.email].join(" ").toLowerCase().includes(q));
        el.innerHTML = list.length ? `
            <table>
                <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Address</th><th>Age</th><th>Role</th><th class="num">Orders</th></tr></thead>
                <tbody>${list.map(u => {
                    const n = orders.filter(o => o.type === "template" && String(o.customer).toLowerCase() === String(u.name).toLowerCase()).length;
                    return `<tr>
                        <td>${esc(u.name)}</td><td class="id">@${esc(u.username)}</td><td>${esc(u.email)}</td>
                        <td>${esc(u.address)}</td><td>${esc(u.age)}</td>
                        <td>${pill(u.role === "admin" ? "admin" : "customer", u.role)}</td>
                        <td class="num">${n}</td></tr>`;
                }).join("")}</tbody>
            </table>` : `<div class="empty">No customers found.</div>`;
    }

    // ---------- PRODUCTS ----------
    function renderProducts() {
        const map = new Map();
        orders.filter(o => o.type === "template").forEach(o => o.items.forEach(i => {
            const key = i.name || i.id || "Unnamed";
            const r = map.get(key) || { name: key, units: 0, orders: 0, revenue: 0 };
            const line = Number(i.price || 0) * Number(i.qty || 1);
            r.units += Number(i.qty || 1); r.orders++;
            if (o.status === "delivered") r.revenue += line;
            map.set(key, r);
        }));
        const rows = [...map.values()].sort((a, b) => b.units - a.units);
        $("productsTable").innerHTML = rows.length ? `
            <table>
                <thead><tr><th>Product</th><th class="num">Units sold</th><th class="num">Orders</th><th class="num">Revenue</th></tr></thead>
                <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.units}</td><td class="num">${r.orders}</td><td class="num">${peso(r.revenue)}</td></tr>`).join("")}</tbody>
            </table>` : `<div class="empty">No product sales yet.</div>`;
    }

    // ---------- CSV ----------
    function exportCsv() {
        const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const head = ["Order ID", "Type", "Status", "Customer", "Details", "Payment", "Amount", "Submitted", "Confirmed", "Delivered"];
        const rows = filteredOrders().map(o => [
            o.id, TYPE_LABEL[o.type], STATUS_LABEL[o.status], o.customer,
            o.type === "customization" ? `${o.template} / ${o.palette}` : o.items.map(i => `${i.name} x${i.qty || 1}`).join("; "),
            o.payment, o.amount,
            o.created?.toISOString() || "", o.confirmed?.toISOString() || "", o.completed?.toISOString() || ""
        ]);
        const csv = "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = "noteme-orders-" + new Date().toISOString().slice(0, 10) + ".csv";
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // ---------- VIEW / ROUTING ----------
    function rerender() {
        refreshOrders();
        renderOverview(); renderOrders(); renderUsers(); renderProducts();
        if (openId) { orders.some(o => o.uid === openId) ? openDrawer(openId) : closeDrawer(); }
    }

    function showView(name) {
        if (!["overview", "orders", "customers", "products"].includes(name)) name = "overview";
        document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== "view-" + name);
        document.querySelectorAll("#sidebar nav a").forEach(a => a.classList.toggle("active", a.dataset.view === name));
        $("viewTitle").textContent = name[0].toUpperCase() + name.slice(1);
        $("sidebar").classList.remove("open");
        closeDrawer();
    }

    // ---------- EVENTS ----------
    function bind() {
        window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

        document.addEventListener("click", e => {
            const act = e.target.closest("[data-act]");
            if (act) {
                e.stopPropagation();
                const o = orders.find(x => x.uid === act.dataset.uid);
                if (!o) return;
                act.dataset.act === "delete" ? removeOrder(o) : setStatus(o, act.dataset.act);
                return;
            }
            const go = e.target.closest("[data-go]");
            if (go) { statusFilter = go.dataset.go; renderOrders(); return; }
            const open = e.target.closest("[data-open]");
            if (open) { openDrawer(open.dataset.open); return; }
            if (e.target.closest("[data-close]") || e.target === $("scrim")) closeDrawer();
        });

        document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

        $("statusTabs").addEventListener("click", e => {
            const b = e.target.closest("button"); if (!b) return;
            statusFilter = b.dataset.status; renderOrders();
        });
        $("typeFilter").addEventListener("change", e => { typeFilter = e.target.value; renderOrders(); });
        $("orderSearch").addEventListener("input", e => { query = e.target.value; renderOrders(); });
        $("userSearch").addEventListener("input", e => { userQuery = e.target.value; renderUsers(); });
        $("exportBtn").addEventListener("click", exportCsv);
        $("refreshBtn").addEventListener("click", () => { rerender(); loadUsers(); toast("Refreshed"); });
        $("burger").addEventListener("click", () => $("sidebar").classList.toggle("open"));

        $("logoutBtn").addEventListener("click", async () => {
            try { await fetch("logout.php", { method: "POST" }); } catch {}
            location.assign("login.html");
        });

        // Live-update when a customer places an order in another tab.
        window.addEventListener("storage", e => {
            if (e.key === ORDERS_KEY || e.key === CUSTOM_KEY) rerender();
        });
    }

    // ---------- BOOT ----------
    async function boot() {
        let user = null;
        try {
            const res = await fetch("session.php", { credentials: "same-origin" });
            user = (await res.json()).user;
        } catch {
            $("gate").textContent = "Unable to reach the server. Make sure PHP/Apache is running.";
            return;
        }
        if (!user || user.role !== "admin") {
            try { sessionStorage.setItem("notemeReturnTo", location.href); } catch {}
            location.replace("login.html");
            return;
        }
        $("adminWho").innerHTML = `<b>${esc(user.name || user.username)}</b>${esc(user.email || "")}`;
        $("gate").hidden = true;
        $("shell").hidden = false;
        bind();
        showView(location.hash.slice(1));
        rerender();
        loadUsers();
    }

    boot();
})();
