import { describe, expect, it } from "vitest";
import { currentActions, matchActions, normalize, registerActions, type Action } from "../src/lib/actions";

const action = (id: string, title: string, keywords = "", section: Action["section"] = "go"): Action => ({
  id,
  title: () => title,
  keywords: () => keywords,
  section,
  run: () => {},
});

const actions = [
  action("page.new", "Nouvelle page", "créer ajouter", "create"),
  action("database.new", "Nouvelle base de données", "créer ajouter table", "create"),
  action("go:trash", "Aller à : Corbeille", "aller ouvrir"),
  action("go:home", "Aller à : Accueil", "aller ouvrir"),
  action("theme:dark", "Thème : Sombre", "thème apparence", "settings"),
];
const ids = (list: Action[]) => list.map((a) => a.id);

describe("the command palette's actions", () => {
  it("are found without accents or capitals", () => {
    expect(normalize("Créer une Entrée")).toBe("creer une entree");
    expect(ids(matchActions(actions, "theme"))).toEqual(["theme:dark"]);
    expect(ids(matchActions(actions, "CORBEILLE"))).toEqual(["go:trash"]);
  });

  it("need every word typed, in the title or the keywords", () => {
    expect(ids(matchActions(actions, "creer base"))).toEqual(["database.new"]);
    expect(ids(matchActions(actions, "nouvelle sombre"))).toEqual([]);
  });

  it("put titles that start with what was typed first", () => {
    expect(ids(matchActions(actions, "nouvelle")).slice(0, 2)).toEqual(["page.new", "database.new"]);
    expect(ids(matchActions(actions, "acc"))).toEqual(["go:home"]);
  });

  it("put the most recently used first", () => {
    expect(ids(matchActions(actions, "", ["theme:dark", "go:home"])).slice(0, 3)).toEqual(["theme:dark", "go:home", "page.new"]);
    expect(ids(matchActions(actions, "aller", ["go:home"]))).toEqual(["go:home", "go:trash"]);
  });

  it("are listed while their part of the app is shown, page actions first", () => {
    const offStart = registerActions("app", () =>
      [action("go:home", "Home"), action("hidden", "Hidden", "", "go")].map((a) => (a.id === "hidden" ? { ...a, when: () => false } : a)),
    );
    const offPage = registerActions("page", () => [action("page:share", "Share", "", "page")]);
    expect(ids(currentActions())).toEqual(["page:share", "go:home"]);
    offPage();
    expect(ids(currentActions())).toEqual(["go:home"]);
    offStart();
    expect(currentActions()).toEqual([]);
  });
});
