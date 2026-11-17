// "assistant" plugin, browser side: entries in the menu of a selection (summarise, translate, improve, continue, ask),
// and a panel under the passage where the answer is written as it comes, to accept, insert below or discard.

const TEXTS = {
  en: {
    menu: "AI",
    summarize: "Summarise",
    translate: "Translate to…",
    improve: "Improve the writing",
    continue: "Continue",
    ask: "Ask…",
    titles: { summarize: "Summary", translate: "Translation", improve: "Improved writing", continue: "Continuation", ask: "Answer" },
    sentTo: "The selected text is sent to {name} ({model}).",
    sentToLocal: "The selected text is sent to the model at {host} ({model}).",
    notConfigured: "Not set up yet: an administrator has to give a key in Administration › Plugins.",
    usage: "{used} of {limit} requests used today.",
    language: "Language",
    languageHint: "English, Deutsch, 日本語…",
    question: "Your question about the selection",
    questionHint: "What are the dates mentioned? Is the tone too formal?…",
    send: "Send",
    sendTranslate: "Translate",
    writing: "Writing…",
    stop: "Stop",
    replace: "Replace",
    insertBelow: "Insert below",
    insert: "Insert",
    retry: "Try again",
    discard: "Discard",
    close: "Close",
    stopped: "Stopped.",
    empty: "The model gave no answer.",
    escape: "Esc to close",
    chat: "AI assistant",
    chatHello: "Ask anything about this page: a summary, what is left to do, a draft to add…",
    chatHint: "Ask about this page…",
    chatSent: "This page is sent to {name} ({model}) with each question.",
    chatSentLocal: "This page is sent to the model at {host} ({model}) with each question.",
    chatCut: "Only the beginning of the page is sent ({max} characters).",
    insertPage: "Insert in the page",
    copy: "Copy",
    copied: "Copied",
    newChat: "New conversation",
    you: "You",
    s1: "Summarise this page",
    s2: "What is left to do?",
    s3: "Suggest a plan for this page",
    s4: "Write a conclusion",
  },
  fr: {
    menu: "IA",
    summarize: "Résumer",
    translate: "Traduire en…",
    improve: "Améliorer l'écriture",
    continue: "Continuer",
    ask: "Demander…",
    titles: { summarize: "Résumé", translate: "Traduction", improve: "Écriture améliorée", continue: "Suite", ask: "Réponse" },
    sentTo: "Le texte sélectionné est envoyé à {name} ({model}).",
    sentToLocal: "Le texte sélectionné est envoyé au modèle de {host} ({model}).",
    notConfigured: "Pas encore configuré : un administrateur doit donner une clé dans Administration › Plugins.",
    usage: "{used} demandes sur {limit} utilisées aujourd'hui.",
    language: "Langue",
    languageHint: "English, Deutsch, 日本語…",
    question: "Votre question sur la sélection",
    questionHint: "Quelles dates sont citées ? Le ton est-il trop formel ?…",
    send: "Envoyer",
    sendTranslate: "Traduire",
    writing: "Écriture…",
    stop: "Arrêter",
    replace: "Remplacer",
    insertBelow: "Insérer en dessous",
    insert: "Insérer",
    retry: "Réessayer",
    discard: "Ignorer",
    close: "Fermer",
    stopped: "Arrêté.",
    empty: "Le modèle n'a rien répondu.",
    escape: "Échap pour fermer",
    chat: "Assistant IA",
    chatHello: "Posez une question sur cette page : un résumé, ce qui reste à faire, un brouillon à ajouter…",
    chatHint: "Une question sur cette page…",
    chatSent: "Cette page est envoyée à {name} ({model}) avec chaque question.",
    chatSentLocal: "Cette page est envoyée au modèle de {host} ({model}) avec chaque question.",
    chatCut: "Seul le début de la page est envoyé ({max} caractères).",
    insertPage: "Insérer dans la page",
    copy: "Copier",
    copied: "Copié",
    newChat: "Nouvelle conversation",
    you: "Vous",
    s1: "Résume cette page",
    s2: "Qu'est-ce qui reste à faire ?",
    s3: "Propose un plan pour cette page",
    s4: "Écris une conclusion",
  },
  de: {
    menu: "KI",
    summarize: "Zusammenfassen",
    translate: "Übersetzen in…",
    improve: "Text verbessern",
    continue: "Fortsetzen",
    ask: "Fragen…",
    titles: { summarize: "Zusammenfassung", translate: "Übersetzung", improve: "Verbesserter Text", continue: "Fortsetzung", ask: "Antwort" },
    sentTo: "Der ausgewählte Text wird an {name} gesendet ({model}).",
    sentToLocal: "Der ausgewählte Text wird an das Modell unter {host} gesendet ({model}).",
    notConfigured: "Noch nicht eingerichtet: Unter Administration › Plugins muss ein Schlüssel eingegeben werden.",
    usage: "{used} von {limit} Anfragen heute verbraucht.",
    language: "Sprache",
    languageHint: "English, Français, 日本語…",
    question: "Ihre Frage zur Auswahl",
    questionHint: "Welche Daten werden genannt? Ist der Ton zu förmlich?…",
    send: "Senden",
    sendTranslate: "Übersetzen",
    writing: "Schreibt…",
    stop: "Stoppen",
    replace: "Ersetzen",
    insertBelow: "Darunter einfügen",
    insert: "Einfügen",
    retry: "Erneut versuchen",
    discard: "Verwerfen",
    close: "Schließen",
    stopped: "Gestoppt.",
    empty: "Das Modell hat nichts geantwortet.",
    escape: "Esc zum Schließen",
    chat: "KI-Assistent",
    chatHello: "Fragen Sie etwas zu dieser Seite: eine Zusammenfassung, was noch zu tun ist, einen Entwurf zum Einfügen…",
    chatHint: "Eine Frage zu dieser Seite…",
    chatSent: "Diese Seite wird mit jeder Frage an {name} gesendet ({model}).",
    chatSentLocal: "Diese Seite wird mit jeder Frage an das Modell unter {host} gesendet ({model}).",
    chatCut: "Nur der Anfang der Seite wird gesendet ({max} Zeichen).",
    insertPage: "In die Seite einfügen",
    copy: "Kopieren",
    copied: "Kopiert",
    newChat: "Neue Unterhaltung",
    you: "Sie",
    s1: "Fasse diese Seite zusammen",
    s2: "Was ist noch zu tun?",
    s3: "Schlage eine Gliederung für diese Seite vor",
    s4: "Schreibe ein Fazit",
  },
  es: {
    menu: "IA",
    summarize: "Resumir",
    translate: "Traducir al…",
    improve: "Mejorar la redacción",
    continue: "Continuar",
    ask: "Preguntar…",
    titles: { summarize: "Resumen", translate: "Traducción", improve: "Redacción mejorada", continue: "Continuación", ask: "Respuesta" },
    sentTo: "El texto seleccionado se envía a {name} ({model}).",
    sentToLocal: "El texto seleccionado se envía al modelo de {host} ({model}).",
    notConfigured: "Aún no configurado: un administrador debe introducir una clave en Administración › Plugins.",
    usage: "{used} de {limit} solicitudes usadas hoy.",
    language: "Idioma",
    languageHint: "English, Deutsch, 日本語…",
    question: "Su pregunta sobre la selección",
    questionHint: "¿Qué fechas se mencionan? ¿Es el tono demasiado formal?…",
    send: "Enviar",
    sendTranslate: "Traducir",
    writing: "Escribiendo…",
    stop: "Detener",
    replace: "Reemplazar",
    insertBelow: "Insertar debajo",
    insert: "Insertar",
    retry: "Reintentar",
    discard: "Descartar",
    close: "Cerrar",
    stopped: "Detenido.",
    empty: "El modelo no respondió nada.",
    escape: "Esc para cerrar",
    chat: "Asistente de IA",
    chatHello: "Pregunte lo que quiera sobre esta página: un resumen, lo que queda por hacer, un borrador para añadir…",
    chatHint: "Una pregunta sobre esta página…",
    chatSent: "Esta página se envía a {name} ({model}) con cada pregunta.",
    chatSentLocal: "Esta página se envía al modelo de {host} ({model}) con cada pregunta.",
    chatCut: "Solo se envía el principio de la página ({max} caracteres).",
    insertPage: "Insertar en la página",
    copy: "Copiar",
    copied: "Copiado",
    newChat: "Nueva conversación",
    you: "Usted",
    s1: "Resume esta página",
    s2: "¿Qué queda por hacer?",
    s3: "Propón un esquema para esta página",
    s4: "Escribe una conclusión",
  },
  it: {
    menu: "IA",
    summarize: "Riassumi",
    translate: "Traduci in…",
    improve: "Migliora la scrittura",
    continue: "Continua",
    ask: "Chiedi…",
    titles: { summarize: "Riassunto", translate: "Traduzione", improve: "Scrittura migliorata", continue: "Seguito", ask: "Risposta" },
    sentTo: "Il testo selezionato viene inviato a {name} ({model}).",
    sentToLocal: "Il testo selezionato viene inviato al modello su {host} ({model}).",
    notConfigured: "Non ancora configurato: un amministratore deve inserire una chiave in Amministrazione › Plugin.",
    usage: "{used} richieste su {limit} usate oggi.",
    language: "Lingua",
    languageHint: "English, Deutsch, 日本語…",
    question: "La tua domanda sulla selezione",
    questionHint: "Quali date sono citate? Il tono è troppo formale?…",
    send: "Invia",
    sendTranslate: "Traduci",
    writing: "Scrittura…",
    stop: "Interrompi",
    replace: "Sostituisci",
    insertBelow: "Inserisci sotto",
    insert: "Inserisci",
    retry: "Riprova",
    discard: "Scarta",
    close: "Chiudi",
    stopped: "Interrotto.",
    empty: "Il modello non ha risposto nulla.",
    escape: "Esc per chiudere",
    chat: "Assistente IA",
    chatHello: "Chiedi qualsiasi cosa su questa pagina: un riassunto, cosa resta da fare, una bozza da aggiungere…",
    chatHint: "Una domanda su questa pagina…",
    chatSent: "Questa pagina viene inviata a {name} ({model}) con ogni domanda.",
    chatSentLocal: "Questa pagina viene inviata al modello su {host} ({model}) con ogni domanda.",
    chatCut: "Viene inviato solo l'inizio della pagina ({max} caratteri).",
    insertPage: "Inserisci nella pagina",
    copy: "Copia",
    copied: "Copiato",
    newChat: "Nuova conversazione",
    you: "Tu",
    s1: "Riassumi questa pagina",
    s2: "Cosa resta da fare?",
    s3: "Proponi una struttura per questa pagina",
    s4: "Scrivi una conclusione",
  },
};

/** Languages offered for a translation (any other may be typed). */
const LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl", "pl", "sv", "da", "ro", "el", "tr", "ru", "uk", "ar", "he", "hi", "zh", "ja", "ko"];
const ERROR_MARK = "\u0000";
/** Longest page sent with a question (characters), as the server allows. */
const MAX_PAGE = 30000;
/** Conversations, per page, while the app is open. */
const chats = new Map();
const LAST_LANGUAGE = "nootion-assistant-language";

const CSS = `
.ai-panel { outline: none; }
.ai-head { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 6px; }
.ai-head .ai-state { font-weight: 400; color: #737373; font-size: 12px; }
.ai-answer p, .ai-answer ul, .ai-answer ol, .ai-answer blockquote { margin: 0 0 6px; }
.ai-answer ul { list-style: disc; padding-left: 22px; }
.ai-answer ol { list-style: decimal; padding-left: 22px; }
.ai-answer blockquote { border-left: 3px solid rgba(128,128,128,.4); padding-left: 10px; }
.ai-answer code { font-size: .9em; background: rgba(128,128,128,.15); border-radius: 4px; padding: 0 4px; }
.ai-answer .ai-h { font-weight: 600; }
.ai-answer { word-break: break-word; max-height: 50vh; overflow: auto; font-size: 15px; line-height: 1.6; }
.ai-answer:empty::before { content: "…"; color: #a3a3a3; }
.ai-error { color: #b91c1c; margin: 4px 0; }
.dark .ai-error { color: #f87171; }
.ai-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ai-form label { font-size: 12px; color: #737373; width: 100%; }
.ai-input { flex: 1; min-width: 180px; border: 1px solid rgba(128,128,128,.35); border-radius: 6px; padding: 5px 8px; font: inherit; background: transparent; color: inherit; }
.ai-input:focus { outline: 2px solid #8b5cf6; outline-offset: -1px; }
.ai-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.ai-btn { border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; border-radius: 6px; padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
.ai-btn:hover { background: rgba(128,128,128,.12); }
.ai-btn:disabled { opacity: .5; cursor: default; }
.ai-btn.ai-primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
.ai-btn.ai-primary:hover { background: #6d28d9; }
.ai-note { margin-top: 8px; font-size: 12px; color: #737373; display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
@keyframes ai-blink { 50% { opacity: 0; } }
.ai-cursor { display: inline-block; width: 7px; height: 1em; vertical-align: text-bottom; background: #8b5cf6; animation: ai-blink 1s steps(1) infinite; margin-left: 1px; }
@media (max-width: 640px) { .ai-btn { padding: 8px 12px; font-size: 14px; } .ai-answer { font-size: 16px; } }
.ai-chat { display: flex; flex-direction: column; height: 100%; font-size: 14px; }
.ai-chat-list { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.ai-msg-user { align-self: flex-end; max-width: 85%; background: #7c3aed; color: #fff; border-radius: 14px 14px 4px 14px; padding: 6px 11px; white-space: pre-wrap; word-break: break-word; }
.ai-msg-bot { align-self: flex-start; max-width: 100%; }
.ai-msg-bot .ai-answer { font-size: 14px; max-height: none; overflow: visible; }
.ai-msg-bot .ai-state { color: #737373; font-size: 12px; }
.ai-msg-tools { display: flex; gap: 4px; margin-top: 4px; }
.ai-msg-tools .ai-btn { font-size: 12px; padding: 2px 8px; }
.ai-hello { color: #737373; margin-bottom: 4px; }
.ai-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ai-chip { border: 1px solid rgba(124,58,237,.35); color: inherit; background: rgba(124,58,237,.06); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 13px; cursor: pointer; }
.ai-chip:hover { background: rgba(124,58,237,.14); }
.ai-chat-foot { border-top: 1px solid rgba(128,128,128,.2); padding: 8px 12px 10px; }
.ai-chat-form { display: flex; gap: 6px; align-items: flex-end; }
.ai-chat-form textarea { flex: 1; resize: none; max-height: 140px; min-height: 38px; }
.ai-chat-foot .ai-note { margin-top: 6px; }
@media (max-width: 640px) { .ai-chat { font-size: 16px; } .ai-chat-form textarea { font-size: 16px; } }
`;

/**
 * A light preview of the Markdown being written: headings, lists, quotes, bold, italics, code. Built as React elements
 * (never as HTML), so nothing the model writes can run in the page. The page gets real blocks once accepted.
 */
function preview(h, text) {
  const inline = (s, key) => {
    const out = [];
    const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
    let last = 0;
    let m;
    let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const t = m[0];
      const k = `${key}-${i++}`;
      if (t.startsWith("**") || t.startsWith("__")) out.push(h("strong", { key: k }, t.slice(2, -2)));
      else if (t.startsWith("`")) out.push(h("code", { key: k }, t.slice(1, -1)));
      else out.push(h("em", { key: k }, t.slice(1, -1)));
      last = m.index + t.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) blocks.push(h(list.ordered ? "ol" : "ul", { key: `l${blocks.length}` }, list.items));
    list = null;
  };
  text.split("\n").forEach((line, n) => {
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = !item[1];
      if (!list || list.ordered !== ordered) (flush(), (list = { ordered, items: [] }));
      list.items.push(h("li", { key: n }, inline(item[3], n)));
      return;
    }
    flush();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) blocks.push(h("p", { key: n, className: "ai-h" }, inline(heading[2], n)));
    else if (/^>\s?/.test(line)) blocks.push(h("blockquote", { key: n }, inline(line.replace(/^>\s?/, ""), n)));
    else if (line.trim()) blocks.push(h("p", { key: n }, inline(line, n)));
  });
  flush();
  return blocks;
}

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

export async function activate(nootion) {
  const { React } = nootion;
  const h = React.createElement;
  const T = TEXTS[nootion.locale] ?? TEXTS.en;
  let info = null;
  const refresh = () =>
    nootion
      .api("/info")
      .then((i) => (info = i))
      .catch(() => {});
  await refresh();

  if (!document.getElementById("nootion-assistant-css")) {
    const style = document.createElement("style");
    style.id = "nootion-assistant-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /** Where the text goes, said before anything is sent. */
  const destination = () => {
    if (!info) return null;
    if (!info.configured) return T.notConfigured;
    const where = fill(info.local ? T.sentToLocal : T.sentTo, { name: info.provider, host: info.host, model: info.model });
    return info.limit ? `${where} ${fill(T.usage, { used: info.used, limit: info.limit })}` : where;
  };

  const shown = (n) => {
    try {
      return new Intl.DisplayNames([nootion.locale], { type: "language" }).of(n) ?? n;
    } catch {
      return n;
    }
  };
  const defaultLanguage = () => {
    try {
      const last = localStorage.getItem(LAST_LANGUAGE);
      if (last) return last;
    } catch {
      // No storage: the default below.
    }
    return shown(nootion.locale === "en" ? "fr" : "en");
  };

  /** Reads the streamed answer; calls onText with all the text so far, and returns { text, error }. */
  async function stream(body, signal, onText) {
    const res = await nootion.fetch("/run", { method: "POST", body, signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let all = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      all += decoder.decode(value, { stream: true });
      const cut = all.indexOf(ERROR_MARK);
      onText(cut >= 0 ? all.slice(0, cut) : all);
    }
    all += decoder.decode();
    const cut = all.indexOf(ERROR_MARK);
    return cut >= 0 ? { text: all.slice(0, cut), error: all.slice(cut + 1) } : { text: all, error: null };
  }

  function Suggestion({ ctx, panel, action }) {
    const needs = action === "translate" ? "language" : action === "ask" ? "question" : null;
    const [phase, setPhase] = React.useState(needs ? "input" : "running");
    const [value, setValue] = React.useState(needs === "language" ? defaultLanguage() : "");
    const [answer, setAnswer] = React.useState("");
    const [error, setError] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const controller = React.useRef(null);
    const root = React.useRef(null);
    const input = React.useRef(null);

    const run = React.useCallback(
      async (extra) => {
        controller.current?.abort();
        const c = new AbortController();
        controller.current = c;
        setPhase("running");
        setAnswer("");
        setError(null);
        try {
          const result = await stream({ action, text: ctx.text, pageId: ctx.pageId, ...extra }, c.signal, setAnswer);
          if (c.signal.aborted) return;
          setAnswer(result.text);
          setError(result.error ?? (result.text.trim() ? null : T.empty));
        } catch (e) {
          if (c.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (controller.current === c) controller.current = null;
          void refresh();
        }
        setPhase("done");
      },
      [action, ctx],
    );
    const extra = () => (needs === "language" ? { language: value.trim() } : needs === "question" ? { question: value.trim() } : {});

    React.useEffect(() => {
      if (!needs) void run({});
      (input.current ?? root.current)?.focus({ preventScroll: true });
      return () => controller.current?.abort();
    }, []);
    // Once written, the main button takes the keyboard (Enter accepts, Esc discards).
    React.useEffect(() => {
      if (phase === "done") root.current?.querySelector(".ai-primary")?.focus({ preventScroll: true });
    }, [phase]);

    const submit = (e) => {
      e?.preventDefault();
      if (!value.trim()) return;
      if (needs === "language") {
        try {
          localStorage.setItem(LAST_LANGUAGE, value.trim());
        } catch {
          // Not remembered: no matter.
        }
      }
      void run(extra());
    };
    const stop = () => {
      controller.current?.abort();
      controller.current = null;
      setError(answer.trim() ? null : T.stopped);
      setPhase("done");
    };
    /** Puts the answer in the page, as blocks (lists, headings…) when the server can read its Markdown. */
    const put = async (how) => {
      setBusy(true);
      let content = answer.trim();
      try {
        const res = await nootion.api("/content", { method: "POST", body: { text: content } });
        if (Array.isArray(res.content) && res.content.length) content = res.content;
      } catch {
        // Plain text then.
      }
      if (panel.open) panel[how](content);
    };

    const title = T.titles[action] + (action === "translate" && phase !== "input" && value.trim() ? ` · ${value.trim()}` : "");
    const head = h(
      "div",
      { className: "ai-head" },
      h("span", { "aria-hidden": true }, "✨"),
      h("span", null, title),
      phase === "running" && h("span", { className: "ai-state", role: "status" }, T.writing),
    );

    let bodyPart;
    if (phase === "input") {
      bodyPart = h(
        "form",
        { className: "ai-form", onSubmit: submit },
        h("label", { htmlFor: "ai-input" }, needs === "language" ? T.language : T.question),
        needs === "language"
          ? h(
              React.Fragment,
              null,
              h("input", {
                id: "ai-input",
                ref: input,
                className: "ai-input",
                list: "ai-languages",
                value,
                placeholder: T.languageHint,
                onChange: (e) => setValue(e.target.value),
                onFocus: (e) => e.target.select(),
                autoComplete: "off",
              }),
              h(
                "datalist",
                { id: "ai-languages" },
                LANGUAGES.map((l) => h("option", { key: l, value: shown(l) })),
              ),
            )
          : h("input", {
              id: "ai-input",
              ref: input,
              className: "ai-input",
              value,
              placeholder: T.questionHint,
              onChange: (e) => setValue(e.target.value),
              autoComplete: "off",
            }),
        h("button", { type: "submit", className: "ai-btn ai-primary", disabled: !value.trim() }, needs === "language" ? T.sendTranslate : T.send),
        h("button", { type: "button", className: "ai-btn", onClick: () => panel.close() }, T.close),
      );
    } else {
      const answerBox = h(
        "div",
        { className: "ai-answer", "aria-live": "polite" },
        preview(h, answer),
        phase === "running" && h("span", { className: "ai-cursor", "aria-hidden": true }),
      );
      const ok = phase === "done" && answer.trim() && !busy;
      const buttons =
        phase === "running"
          ? [h("button", { key: "stop", type: "button", className: "ai-btn", onClick: stop }, T.stop)]
          : action === "continue"
            ? [
                h("button", { key: "insert", type: "button", className: "ai-btn ai-primary", disabled: !ok, onClick: () => put("insertAfter") }, T.insert),
                h("button", { key: "retry", type: "button", className: "ai-btn", onClick: () => run(extra()) }, T.retry),
                h("button", { key: "discard", type: "button", className: "ai-btn", onClick: () => panel.close() }, T.discard),
              ]
            : action === "improve" || action === "translate"
              ? [
                  h("button", { key: "replace", type: "button", className: "ai-btn ai-primary", disabled: !ok, onClick: () => put("replace") }, T.replace),
                  h("button", { key: "below", type: "button", className: "ai-btn", disabled: !ok, onClick: () => put("insertBelow") }, T.insertBelow),
                  h("button", { key: "retry", type: "button", className: "ai-btn", onClick: () => run(extra()) }, T.retry),
                  h("button", { key: "discard", type: "button", className: "ai-btn", onClick: () => panel.close() }, T.discard),
                ]
              : [
                  h(
                    "button",
                    { key: "below", type: "button", className: "ai-btn ai-primary", disabled: !ok, onClick: () => put("insertBelow") },
                    T.insertBelow,
                  ),
                  h("button", { key: "replace", type: "button", className: "ai-btn", disabled: !ok, onClick: () => put("replace") }, T.replace),
                  h("button", { key: "retry", type: "button", className: "ai-btn", onClick: () => run(extra()) }, T.retry),
                  h("button", { key: "discard", type: "button", className: "ai-btn", onClick: () => panel.close() }, T.discard),
                ];
      bodyPart = h(
        React.Fragment,
        null,
        (answer || phase === "running") && answerBox,
        error && h("div", { className: "ai-error", role: "alert" }, error),
        h("div", { className: "ai-actions" }, buttons),
      );
    }
    return h(
      "div",
      { className: "ai-panel", ref: root, tabIndex: -1, "data-assistant": action },
      head,
      bodyPart,
      h("div", { className: "ai-note" }, h("span", null, destination()), h("span", null, T.escape)),
    );
  }

  /** The chat of the round button: questions about the page open, answers to insert in it. */
  function Chat({ ctx }) {
    const [messages, setMessages] = React.useState(() => chats.get(ctx.pageId) ?? []);
    const [draft, setDraft] = React.useState("");
    const [running, setRunning] = React.useState(false);
    const [copied, setCopied] = React.useState(-1);
    const controller = React.useRef(null);
    const list = React.useRef(null);
    const box = React.useRef(null);

    React.useEffect(() => {
      chats.set(ctx.pageId, messages);
      list.current?.scrollTo({ top: list.current.scrollHeight });
    }, [messages]);
    React.useEffect(() => {
      box.current?.focus({ preventScroll: true });
      return () => controller.current?.abort();
    }, []);

    const pageText = () => ctx.text();
    const ask = async (question) => {
      const q = question.trim();
      if (!q || running) return;
      const history = [...messages.filter((m) => !m.error), { role: "user", content: q }];
      setMessages([...messages, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);
      setDraft("");
      setRunning(true);
      const c = new AbortController();
      controller.current = c;
      const update = (patch) =>
        setMessages((all) => {
          const next = all.slice();
          next[next.length - 1] = { ...next[next.length - 1], ...patch };
          return next;
        });
      try {
        const res = await nootion.fetch("/chat", {
          method: "POST",
          signal: c.signal,
          body: {
            pageId: ctx.pageId,
            title: ctx.title(),
            text: pageText().slice(0, MAX_PAGE),
            messages: history.map(({ role, content }) => ({ role, content })),
          },
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let all = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          all += decoder.decode(value, { stream: true });
          const cut = all.indexOf(ERROR_MARK);
          update({ content: cut >= 0 ? all.slice(0, cut) : all });
        }
        const cut = all.indexOf(ERROR_MARK);
        const text = cut >= 0 ? all.slice(0, cut) : all;
        update({ content: text, pending: false, error: cut >= 0 ? all.slice(cut + 1) : text.trim() ? null : T.empty });
      } catch (e) {
        if (c.signal.aborted) update({ pending: false, error: null, stopped: true });
        else update({ pending: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (controller.current === c) controller.current = null;
        setRunning(false);
        void refresh();
      }
    };
    const insert = async (text) => {
      let content = text.trim();
      try {
        const res = await nootion.api("/content", { method: "POST", body: { text: content } });
        if (Array.isArray(res.content) && res.content.length) content = res.content;
      } catch {
        // Plain text then.
      }
      ctx.insert(content);
    };
    const copy = async (text, i) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(i);
        setTimeout(() => setCopied(-1), 1500);
      } catch {
        // No clipboard here.
      }
    };

    const note = !info?.configured
      ? T.notConfigured
      : fill(info.local ? T.chatSentLocal : T.chatSent, { name: info.provider, host: info.host, model: info.model }) +
        (info.limit ? ` ${fill(T.usage, { used: info.used, limit: info.limit })}` : "") +
        (pageText().length > MAX_PAGE ? ` ${fill(T.chatCut, { max: MAX_PAGE.toLocaleString(nootion.locale) })}` : "");

    return h(
      "div",
      { className: "ai-chat", "data-assistant-chat": "" },
      h(
        "div",
        { className: "ai-chat-list", ref: list, "aria-live": "polite" },
        !messages.length &&
          h(
            React.Fragment,
            null,
            h("div", { className: "ai-hello" }, T.chatHello),
            h(
              "div",
              { className: "ai-chips" },
              [T.s1, T.s2, T.s3, T.s4].map((s) => h("button", { key: s, type: "button", className: "ai-chip", onClick: () => ask(s) }, s)),
            ),
          ),
        messages.map((m, i) =>
          m.role === "user"
            ? h("div", { key: i, className: "ai-msg-user", "aria-label": T.you }, m.content)
            : h(
                "div",
                { key: i, className: "ai-msg-bot" },
                h("div", { className: "ai-answer" }, preview(h, m.content), m.pending && h("span", { className: "ai-cursor", "aria-hidden": true })),
                m.stopped && h("div", { className: "ai-state" }, T.stopped),
                m.error && h("div", { className: "ai-error", role: "alert" }, m.error),
                !m.pending &&
                  m.content.trim() &&
                  h(
                    "div",
                    { className: "ai-msg-tools" },
                    ctx.canEdit && h("button", { type: "button", className: "ai-btn", onClick: () => insert(m.content) }, T.insertPage),
                    h("button", { type: "button", className: "ai-btn", onClick: () => copy(m.content, i) }, copied === i ? T.copied : T.copy),
                  ),
              ),
        ),
      ),
      h(
        "div",
        { className: "ai-chat-foot" },
        h(
          "form",
          {
            className: "ai-chat-form",
            onSubmit: (e) => {
              e.preventDefault();
              void ask(draft);
            },
          },
          h("textarea", {
            ref: box,
            className: "ai-input",
            rows: 1,
            value: draft,
            placeholder: T.chatHint,
            "aria-label": T.chatHint,
            onChange: (e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            },
            onKeyDown: (e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(draft);
              }
            },
          }),
          running
            ? h("button", { type: "button", className: "ai-btn", onClick: () => controller.current?.abort() }, T.stop)
            : h("button", { type: "submit", className: "ai-btn ai-primary", disabled: !draft.trim() || !info?.configured }, T.send),
        ),
        h(
          "div",
          { className: "ai-note" },
          h("span", null, note),
          messages.length > 0 &&
            !running &&
            h("button", { type: "button", className: "ai-btn", style: { fontSize: 12, padding: "1px 8px" }, onClick: () => setMessages([]) }, T.newChat),
        ),
      ),
    );
  }

  nootion.registerPagePanel({
    label: T.chat,
    icon: "✨",
    visible: () => !!info?.available,
    render: (ctx) => h(Chat, { key: ctx.pageId, ctx }),
  });

  const entry = (id, icon) => ({
    id,
    icon,
    label: T[id],
    run: (ctx) => {
      ctx.showPanel((panel) => h(Suggestion, { ctx, panel, action: id }));
    },
  });

  nootion.registerSelectionMenu({
    label: T.menu,
    icon: "✨",
    visible: () => !!info?.available,
    note: destination,
    actions: [entry("summarize", "📝"), entry("translate", "🌐"), entry("improve", "✍️"), entry("continue", "➡️"), entry("ask", "💬")],
  });
}
