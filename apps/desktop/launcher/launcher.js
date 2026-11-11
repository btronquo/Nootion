// The server picker shown before a Nootion server is opened. Plain JavaScript, no build step:
// it talks to the Rust side through window.__TAURI__ (see src-tauri/src/lib.rs).

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

const TEXT = {
  fr: {
    tagline: "Connectez-vous à votre serveur Nootion.",
    yourServers: "Vos serveurs",
    addServer: "Ajouter un serveur",
    editServer: "Modifier le serveur",
    address: "Adresse du serveur",
    name: "Nom (facultatif)",
    namePlaceholder: "Maison, Travail…",
    connect: "Se connecter",
    save: "Enregistrer",
    connectAnyway: "Se connecter quand même",
    cancel: "Annuler",
    checking: "Vérification du serveur…",
    opening: "Ouverture…",
    edit: "Modifier",
    remove: "Retirer",
    confirmRemove: "Retirer ?",
    localTitle: "Sur cet ordinateur",
    localSoon: "Bientôt : un espace Nootion local, sans serveur, synchronisé quand vous le souhaitez.",
    version: "Nootion pour ordinateur {v}",
    serverVersion: "version {v}",
    neverOpened: "jamais ouvert",
    insecure: "Ce serveur n'utilise pas HTTPS : votre mot de passe circulerait en clair sur le réseau.",
    err_invalid_url: "Cette adresse n'est pas valide. Exemple : notes.example.org",
    err_unreachable: "Impossible de joindre ce serveur. Vérifiez l'adresse et votre connexion.",
    err_timeout: "Le serveur ne répond pas (délai dépassé).",
    err_tls: "Le certificat HTTPS de ce serveur n'est pas valide.",
    err_not_nootion: "Un serveur répond à cette adresse, mais ce n'est pas Nootion.",
    err_save_failed: "Le serveur répond, mais il n'a pas pu être enregistré sur cet ordinateur.",
    err_unknown: "Une erreur inattendue s'est produite.",
  },
  en: {
    tagline: "Connect to your Nootion server.",
    yourServers: "Your servers",
    addServer: "Add a server",
    editServer: "Edit server",
    address: "Server address",
    name: "Name (optional)",
    namePlaceholder: "Home, Work…",
    connect: "Connect",
    save: "Save",
    connectAnyway: "Connect anyway",
    cancel: "Cancel",
    checking: "Checking the server…",
    opening: "Opening…",
    edit: "Edit",
    remove: "Remove",
    confirmRemove: "Remove?",
    localTitle: "On this computer",
    localSoon: "Coming soon: a local Nootion space, no server needed, synced when you want.",
    version: "Nootion for desktop {v}",
    serverVersion: "version {v}",
    neverOpened: "never opened",
    insecure: "This server doesn't use HTTPS: your password would travel unencrypted over the network.",
    err_invalid_url: "This address isn't valid. Example: notes.example.org",
    err_unreachable: "Can't reach this server. Check the address and your connection.",
    err_timeout: "The server isn't answering (timed out).",
    err_tls: "This server's HTTPS certificate isn't valid.",
    err_not_nootion: "Something answers at this address, but it isn't Nootion.",
    err_save_failed: "The server answers, but it couldn't be saved on this computer.",
    err_unknown: "Something unexpected went wrong.",
  },
};

let lang = "en";
const t = (key, vars = {}) => (TEXT[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

const $ = (id) => document.getElementById(id);
const form = $("add-form");
const urlInput = $("url");
const nameInput = $("name");
const connectBtn = $("connect");
const cancelBtn = $("cancel");
const message = $("message");

/** The address the user accepted to use without HTTPS, so the second click goes through. */
let insecureAccepted = null;
/** The profile being edited, if any. */
let editing = null;

function translate() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll("[data-t-placeholder]")) el.placeholder = t(el.dataset.tPlaceholder);
}

function say(text, kind = "") {
  message.textContent = text;
  message.className = kind;
  message.hidden = !text;
}

function errorText(e) {
  const code = typeof e === "object" && e && "code" in e ? e.code : "unknown";
  return TEXT[lang][`err_${code}`] ? t(`err_${code}`) : t("err_unknown");
}

function busy(on, label) {
  connectBtn.disabled = on;
  urlInput.disabled = on;
  nameInput.disabled = on;
  if (label) say(label);
}

function resetForm() {
  editing = null;
  insecureAccepted = null;
  form.reset();
  $("add-title").textContent = t("addServer");
  connectBtn.textContent = t("connect");
  cancelBtn.hidden = true;
  say("");
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
}

function render(state) {
  const list = $("servers");
  list.replaceChildren();
  $("servers-section").hidden = state.profiles.length === 0;
  for (const p of state.profiles) {
    const li = document.createElement("li");

    const open = document.createElement("button");
    open.className = "open";
    open.type = "button";
    const name = document.createElement("strong");
    name.textContent = p.name;
    const meta = document.createElement("span");
    const host = p.url.replace(/^https:\/\//, "");
    const details = [host];
    if (p.version) details.push(t("serverVersion", { v: p.version }));
    details.push(p.lastUsedAt ? formatDate(p.lastUsedAt) : t("neverOpened"));
    meta.textContent = details.join(" · ");
    open.append(name, meta);
    open.addEventListener("click", () => openServer(p.id));

    const edit = document.createElement("button");
    edit.className = "icon";
    edit.type = "button";
    edit.textContent = t("edit");
    edit.addEventListener("click", () => {
      editing = p;
      insecureAccepted = null;
      urlInput.value = p.url;
      nameInput.value = p.name;
      $("add-title").textContent = t("editServer");
      connectBtn.textContent = t("save");
      cancelBtn.hidden = false;
      say("");
      urlInput.focus();
    });

    const remove = document.createElement("button");
    remove.className = "icon";
    remove.type = "button";
    remove.textContent = t("remove");
    let armed = null;
    remove.addEventListener("click", async () => {
      if (!armed) {
        remove.textContent = t("confirmRemove");
        armed = setTimeout(() => {
          armed = null;
          remove.textContent = t("remove");
        }, 3000);
        return;
      }
      clearTimeout(armed);
      await invoke("remove_server", { id: p.id });
      if (editing?.id === p.id) resetForm();
      await refresh();
    });

    li.append(open, edit, remove);
    list.append(li);
  }
}

async function refresh() {
  const state = await invoke("launcher_state");
  render(state);
  return state;
}

async function openServer(id) {
  busy(true, t("opening"));
  try {
    await invoke("open_server", { id });
  } catch (e) {
    busy(false);
    say(errorText(e), "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value;
  busy(true, t("checking"));
  try {
    const checked = await invoke("check_server", { url });
    if (checked.insecure && insecureAccepted !== checked.url) {
      insecureAccepted = checked.url;
      busy(false);
      say(t("insecure"), "warn");
      connectBtn.textContent = t("connectAnyway");
      return;
    }
    const wasEditing = editing;
    // Editing a server's address saves it as a new server: forget the old one.
    const profile = await invoke("add_server", { url: checked.url, name: nameInput.value });
    if (wasEditing && wasEditing.id !== profile.id) await invoke("remove_server", { id: wasEditing.id });
    if (wasEditing) {
      resetForm();
      busy(false);
      await refresh();
      return;
    }
    await openServer(profile.id);
  } catch (e) {
    busy(false);
    say(errorText(e), "error");
  }
});

urlInput.addEventListener("input", () => {
  insecureAccepted = null;
  connectBtn.textContent = editing ? t("save") : t("connect");
  if (message.className !== "") say("");
});

cancelBtn.addEventListener("click", resetForm);

async function start() {
  const state = await invoke("launcher_state");
  lang = state.french ? "fr" : "en";
  translate();
  $("version").textContent = t("version", { v: state.version });
  const choose = new URLSearchParams(location.search).has("choose");
  // Reopen the last server at start, without showing the picker.
  if (!choose && state.last && state.profiles.some((p) => p.id === state.last)) {
    try {
      await invoke("open_server", { id: state.last });
      return;
    } catch {
      // Fall through to the picker.
    }
  }
  render(state);
  $("app").hidden = false;
  if (state.profiles.length === 0) urlInput.focus();
}

start().catch((e) => {
  document.body.textContent = String(e);
});
