"use strict";

const POLL_MS = 5000;
const $ = (sel) => document.querySelector(sel);
const app = $("#app");
const main = $("#main");
const convsEl = $("#convs");

const state = {
  messages: [],
  convs: [],
  selected: null, // numero, "__new__" oppure null
  view: "list", // list | thread | settings
  configured: null,
  online: null,
  loaded: false,
  seen: loadSeen(),
};

/* ---------- utilità ---------- */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function icon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${id}`);
  svg.append(use);
  return svg;
}

function loadSeen() {
  try { return JSON.parse(localStorage.getItem("sms-seen") || "null"); } catch { return null; }
}
function saveSeen() {
  try { localStorage.setItem("sms-seen", JSON.stringify(state.seen)); } catch {}
}

function toast(text, isError = false) {
  const t = h("div", { class: "toast" + (isError ? " err" : "") }, text);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), isError ? 6000 : 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || `Errore ${res.status}`);
  return data;
}

const timeFmt = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long" });
const shortFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });

function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const diff = (dayStart(new Date()) - dayStart(d)) / 86400000;
  if (diff === 0) return timeFmt.format(d);
  if (diff === 1) return "Ieri";
  return shortFmt.format(d);
}

function validDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const diff = (dayStart(new Date()) - dayStart(d)) / 86400000;
  if (diff === 0) return "Oggi";
  if (diff === 1) return "Ieri";
  return dayFmt.format(d);
}

function hue(str) {
  let n = 0;
  for (const c of str) n = (n * 31 + c.charCodeAt(0)) % 360;
  return n;
}

function avatar(number) {
  const first = number.trim()[0] || "?";
  const isLetter = /\p{L}/u.test(first);
  const a = h("span", { class: "avatar", "aria-hidden": "true" }, isLetter ? first.toUpperCase() : icon("phone"));
  a.style.setProperty("--h", hue(number));
  return a;
}

function smsCount(text) {
  const unicode = /[^\u0000-\u007f€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const len = text.length;
  return { len, parts: len <= single ? (len ? 1 : 0) : Math.ceil(len / multi), single };
}

/* ---------- dati ---------- */

function buildConvs() {
  const map = new Map();
  for (const m of state.messages) {
    const key = m.number || "Sconosciuto";
    if (!map.has(key)) map.set(key, { number: key, msgs: [] });
    map.get(key).msgs.push(m);
  }
  state.convs = [...map.values()]
    .map((c) => ({ ...c, last: c.msgs[c.msgs.length - 1] }))
    .sort((a, b) => b.last.id - a.last.id);
}

function isUnread(conv) {
  const seen = (state.seen && state.seen[conv.number]) || 0;
  return conv.msgs.some((m) => !m.outgoing && m.id > seen);
}

function markSeen(number) {
  const conv = state.convs.find((c) => c.number === number);
  if (!conv) return;
  state.seen = state.seen || {};
  const max = conv.msgs[conv.msgs.length - 1].id;
  if (state.seen[number] !== max) { state.seen[number] = max; saveSeen(); }
}

async function refresh({ silent = true } = {}) {
  try {
    const data = await api("/api/messages");
    state.configured = data.configured;
    state.online = true;
    state.messages = data.messages;
    buildConvs();
    if (state.seen === null) { // primo avvio: nulla è "non letto"
      state.seen = {};
      for (const c of state.convs) state.seen[c.number] = c.last.id;
      saveSeen();
    }
    const firstLoad = !state.loaded;
    state.loaded = true;
    if (state.selected && state.selected !== "__new__") markSeen(state.selected);
    renderConn();
    renderList();
    if (firstLoad && !state.configured) openSettings();
    else renderMain({ keepComposer: true });
  } catch (err) {
    state.online = false;
    state.loaded = true;
    renderConn(err.message);
    renderList();
    if (!silent) toast(err.message, true);
  }
}

/* ---------- rendering ---------- */

function setView(view) {
  state.view = view;
  app.dataset.view = view;
}

function renderConn(error) {
  const dot = $("#conn .dot");
  const label = $("#conn-label");
  if (state.online === null) { dot.dataset.s = "idle"; label.textContent = "Connessione in corso"; }
  else if (state.online) { dot.dataset.s = "ok"; label.textContent = "Router connesso"; }
  else { dot.dataset.s = "err"; label.textContent = error || "Router non raggiungibile"; }
}

function renderList() {
  convsEl.replaceChildren();
  $("#count").textContent = state.convs.length ? String(state.convs.length) : "";
  if (!state.loaded) {
    for (let i = 0; i < 5; i++) convsEl.append(h("li", { class: "skel" }, h("i"), h("i"), h("i")));
    return;
  }
  if (!state.convs.length) {
    convsEl.append(h("li", { class: "center" }, h("div", { class: "empty" },
      h("span", { class: "ic-wrap" }, icon("chat")),
      h("h3", {}, "Nessun messaggio"),
      h("p", {}, state.online === false
        ? "Non riesco a leggere la SIM. Controlla le impostazioni del router."
        : "Gli SMS ricevuti dal router compariranno qui da soli."))));
    return;
  }
  for (const c of state.convs) {
    const preview = (c.last.outgoing ? "Tu: " : "") + c.last.text.replace(/\s+/g, " ");
    convsEl.append(h("li", {},
      h("button", {
        class: "conv" + (isUnread(c) ? " unread" : ""),
        type: "button",
        "aria-current": String(state.selected === c.number),
        onclick: () => openThread(c.number),
      },
      avatar(c.number),
      h("span", { class: "conv-name" }, c.number),
      h("span", { class: "conv-time" }, relTime(c.last.timestamp)),
      h("span", { class: "conv-preview" }, preview))));
  }
}

function renderMain({ keepComposer = false } = {}) {
  if (state.view === "settings") return;
  if (!state.selected) return renderEmptyMain();
  const existing = main.querySelector(".msgs");
  if (existing && keepComposer && state.selected !== "__new__") return renderMessages(existing);
  if (existing && keepComposer && state.selected === "__new__") return;
  renderThread();
}

function renderEmptyMain() {
  main.replaceChildren(h("div", { class: "center" }, h("div", { class: "empty" },
    h("span", { class: "ic-wrap" }, icon("chat")),
    h("h3", {}, "Scegli una conversazione"),
    h("p", {}, "Oppure scrivi a un nuovo numero con il pulsante in alto."))));
}

function renderThread() {
  const isNew = state.selected === "__new__";
  const conv = state.convs.find((c) => c.number === state.selected);
  const number = isNew ? "" : state.selected;

  const head = h("div", { class: "thread-head" },
    h("button", { class: "btn btn-icon btn-ghost back", type: "button", "aria-label": "Torna alle conversazioni", onclick: backToList }, icon("back")),
    isNew ? null : avatar(number),
    h("div", { class: "thread-title" },
      h("h2", {}, isNew ? "Nuovo messaggio" : number),
      isNew ? null : h("p", {}, `${conv ? conv.msgs.length : 0} messaggi`)),
    isNew ? null : deleteButton("Elimina chat", "Eliminare tutta la chat?", async () => {
      await deleteIds(conv.msgs.map((m) => m.id), "Conversazione eliminata.");
      backToList();
    }));

  const toInput = h("input", { class: "input", id: "to", type: "tel", inputmode: "tel", autocomplete: "off", placeholder: "+391234567890", "aria-label": "Numero destinatario" });
  const newTo = isNew ? h("div", { class: "new-to" }, h("label", { class: "field" }, h("span", {}, "A"), toInput)) : null;

  const body = isNew
    ? h("div", { class: "msgs" }, h("div", { class: "center" }, h("div", { class: "empty" },
        h("span", { class: "ic-wrap" }, icon("send")),
        h("h3", {}, "Scrivi a un numero"),
        h("p", {}, "Inserisci il numero con il prefisso internazionale."))))
    : h("div", { class: "msgs", id: "msgs" });

  const text = h("textarea", { class: "input", id: "text", rows: "1", placeholder: "Scrivi un messaggio", "aria-label": "Testo del messaggio" });
  const counter = h("span", {}, "");
  const send = h("button", { class: "btn btn-primary", type: "submit" }, icon("send"), h("span", {}, "Invia"));
  send.disabled = true;

  const form = h("form", { class: "composer" },
    h("div", { class: "row" }, text, send),
    h("div", { class: "hint" }, counter, h("span", {}, "Ctrl+Invio per inviare")));

  const update = () => {
    const { len, parts, single } = smsCount(text.value);
    counter.textContent = len ? `${len} caratteri, ${parts} ${parts === 1 ? "SMS" : "SMS"}${parts > 1 ? "" : ` (max ${single})`}` : "";
    send.disabled = !text.value.trim() || (isNew && !toInput.value.trim());
    text.style.height = "auto";
    text.style.height = Math.min(text.scrollHeight + 2, 160) + "px";
  };
  text.addEventListener("input", update);
  toInput.addEventListener("input", update);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const target = isNew ? toInput.value : number;
    send.disabled = true;
    send.classList.add("loading");
    try {
      await api("/api/send", { method: "POST", body: JSON.stringify({ number: target, text: text.value }) });
      text.value = "";
      toast("Messaggio inviato.");
      const normalized = target.replace(/\s+/g, "");
      if (isNew) {
        state.selected = normalized;
        await refresh();
        renderThread();
        $("#text")?.focus();
        return;
      }
      await refresh();
    } catch (err) {
      toast(err.message, true);
    } finally {
      update();
    }
  });

  main.replaceChildren(...[head, newTo, body, form].filter(Boolean));
  if (!isNew) renderMessages(body, true);
  update();
}

function renderMessages(container, forceBottom = false) {
  const conv = state.convs.find((c) => c.number === state.selected);
  if (!conv) return;
  const nearBottom = forceBottom || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  const frag = document.createDocumentFragment();
  let lastDay = "";
  for (const m of conv.msgs) {
    const when = validDate(m.timestamp);
    if (when) {
      const day = dayLabel(m.timestamp);
      if (day !== lastDay) { lastDay = day; frag.append(h("div", { class: "day" }, day)); }
    }
    const otp = !m.outgoing && m.text.length < 300 ? (m.text.match(/\b\d{4,8}\b/) || [])[0] : null;
    const pending = m.state === "sending" || m.state === "receiving" || m.state === "stored";
    frag.append(h("div", { class: "msg " + (m.outgoing ? "out" : "in") },
      h("div", { class: "bubble" }, m.text || "(vuoto)"),
      otp ? h("div", { class: "otp" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => copy(otp) }, icon("copy"), `Copia ${otp}`)) : null,
      h("div", { class: "meta" },
        when ? h("span", {}, timeFmt.format(when)) : null,
        pending ? h("span", { class: "msg-state" }, m.state === "sending" ? "In invio" : "In attesa") : null,
        h("span", { class: "msg-actions" },
          deleteButton("", "Eliminare?", () => deleteIds([m.id], "Messaggio eliminato."), true)))));
  }
  container.replaceChildren(frag);
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function deleteButton(label, armedLabel, action, compact = false) {
  const btn = h("button", {
    class: "btn btn-danger " + (compact ? "btn-sm" : "btn-ghost btn-sm"),
    type: "button",
    "aria-label": label || "Elimina messaggio",
  }, icon("trash"), label ? h("span", {}, label) : null);
  let timer;
  btn.addEventListener("click", async () => {
    if (btn.dataset.armed !== "true") {
      btn.dataset.armed = "true";
      btn.replaceChildren(icon("trash"), h("span", {}, armedLabel));
      timer = setTimeout(() => {
        btn.dataset.armed = "false";
        btn.replaceChildren(icon("trash"), label ? h("span", {}, label) : "");
      }, 3500);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    try { await action(); } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
  return btn;
}

async function deleteIds(ids, okText) {
  await api("/api/delete", { method: "POST", body: JSON.stringify({ ids }) });
  toast(okText);
  await refresh();
  if (state.selected && !state.convs.some((c) => c.number === state.selected)) backToList();
}

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }, value);
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  }
  toast(`Codice ${value} copiato.`);
}

/* ---------- navigazione ---------- */

function openThread(number) {
  state.selected = number;
  setView("thread");
  markSeen(number);
  renderList();
  renderThread();
}

function backToList() {
  state.selected = null;
  setView("list");
  renderList();
  renderEmptyMain();
}

function openNew() {
  state.selected = "__new__";
  setView("thread");
  renderList();
  renderThread();
  $("#to")?.focus();
}

async function openSettings() {
  setView("settings");
  state.selected = null;
  renderList();
  let cfg = { host: "", user: "root", modem: "0", has_password: false, configured: false };
  try { cfg = await api("/api/config"); } catch (err) { toast(err.message, true); }

  const error = h("div", { class: "form-error", role: "alert", hidden: true });
  const host = h("input", { class: "input", name: "host", value: cfg.host, placeholder: "192.168.1.1", required: true, autocomplete: "off", inputmode: "url" });
  const user = h("input", { class: "input", name: "user", value: cfg.user, autocomplete: "off" });
  const pass = h("input", { class: "input", name: "password", type: "password", autocomplete: "new-password", placeholder: cfg.has_password ? "Invariata" : "Password SSH" });
  const modem = h("input", { class: "input", name: "modem", value: cfg.modem, inputmode: "numeric", pattern: "[0-9]+" });
  const save = h("button", { class: "btn btn-primary", type: "submit" }, h("span", {}, "Salva e verifica"));

  const form = h("form", {},
    error,
    h("label", { class: "field" }, h("span", {}, "Indirizzo del router"), host),
    h("div", { class: "grid-2" },
      h("label", { class: "field" }, h("span", {}, "Utente SSH"), user),
      h("label", { class: "field" }, h("span", {}, "Indice modem"), modem)),
    h("label", { class: "field" }, h("span", {}, "Password"), pass),
    h("div", { class: "form-actions" }, save,
      cfg.configured ? h("button", { class: "btn btn-ghost", type: "button", onclick: backToList }, "Annulla") : null));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    save.disabled = true;
    save.firstChild.textContent = "Verifica in corso";
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ host: host.value, user: user.value, password: pass.value, modem: modem.value }) });
      toast("Router collegato.");
      state.loaded = false;
      backToList();
      await refresh();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      save.disabled = false;
      save.firstChild.textContent = "Salva e verifica";
    }
  });

  main.replaceChildren(
    h("div", { class: "thread-head" },
      h("button", { class: "btn btn-icon btn-ghost back", type: "button", "aria-label": "Indietro", onclick: backToList }, icon("back")),
      h("span", { class: "avatar", style: "--h:268", "aria-hidden": "true" }, icon("router")),
      h("div", { class: "thread-title" }, h("h2", {}, cfg.configured ? "Impostazioni router" : "Collega il router"))),
    h("div", { class: "settings" },
      h("p", { class: "lead" }, "L'app legge gli SMS dal modem del router via SSH. I dati restano sul tuo server Umbrel e la password non viene mai mostrata di nuovo."),
      form));
  host.focus();
}

/* ---------- avvio ---------- */

$("#btn-new").addEventListener("click", openNew);
$("#btn-settings").addEventListener("click", openSettings);

renderConn();
renderList();
renderEmptyMain();
refresh({ silent: true });

let timer = setInterval(refresh, POLL_MS);
document.addEventListener("visibilitychange", () => {
  clearInterval(timer);
  if (!document.hidden) { refresh(); timer = setInterval(refresh, POLL_MS); }
});
