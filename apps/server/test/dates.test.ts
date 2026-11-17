import { describe, expect, it } from "vitest";
import { parseNaturalDate, reminderTime } from "@nootion/shared";

// Thursday 29 October 2026, 10:30.
const now = new Date(2026, 9, 29, 10, 30);
const p = (text: string, order: "dmy" | "mdy" = "dmy") => parseNaturalDate(text, now, order)?.date ?? null;

describe("dates in plain words", () => {
  it("understands relative days in French and English", () => {
    expect(p("aujourd'hui")).toBe("2026-10-29");
    expect(p("Today")).toBe("2026-10-29");
    expect(p("demain")).toBe("2026-10-30");
    expect(p("tomorrow")).toBe("2026-10-30");
    expect(p("hier")).toBe("2026-10-28");
    expect(p("yesterday")).toBe("2026-10-28");
    expect(p("après-demain")).toBe("2026-10-31");
    expect(p("day after tomorrow")).toBe("2026-10-31");
    expect(p("avant-hier")).toBe("2026-10-27");
  });

  it("understands days of the week", () => {
    expect(p("vendredi")).toBe("2026-10-30");
    expect(p("friday")).toBe("2026-10-30");
    expect(p("jeudi")).toBe("2026-11-05");
    expect(p("thu")).toBe("2026-11-05");
    expect(p("lundi")).toBe("2026-11-02");
    expect(p("next monday")).toBe("2026-11-02");
    expect(p("vendredi prochain")).toBe("2026-11-06");
    expect(p("next friday")).toBe("2026-11-06");
    expect(p("prochain mardi")).toBe("2026-11-03");
    expect(p("semaine prochaine")).toBe("2026-11-02");
    expect(p("next week")).toBe("2026-11-02");
    expect(p("le mois prochain")).toBe("2026-11-01");
    expect(p("ce week-end")).toBe("2026-10-31");
  });

  it("understands spans of time", () => {
    expect(p("dans 3 jours")).toBe("2026-11-01");
    expect(p("in 3 days")).toBe("2026-11-01");
    expect(p("dans une semaine")).toBe("2026-11-05");
    expect(p("in two weeks")).toBe("2026-11-12");
    expect(p("dans 2 heures")).toBe("2026-10-29T12:30");
    expect(p("in 15 min")).toBe("2026-10-29T10:45");
    expect(p("il y a 2 jours")).toBe("2026-10-27");
    expect(p("3 days ago")).toBe("2026-10-26");
    expect(p("dans un mois")).toBe("2026-11-29");
  });

  it("understands written dates", () => {
    expect(p("15 novembre")).toBe("2026-11-15");
    expect(p("1er décembre 2027")).toBe("2027-12-01");
    expect(p("november 15")).toBe("2026-11-15");
    expect(p("Nov 15th, 2026")).toBe("2026-11-15");
    expect(p("15th of november")).toBe("2026-11-15");
    expect(p("le 15")).toBe("2026-11-15");
    expect(p("the 30th")).toBe("2026-10-30");
    expect(p("2026-12-24")).toBe("2026-12-24");
    expect(p("03/11")).toBe("2026-11-03");
    expect(p("03/11", "mdy")).toBe("2027-03-11");
    expect(p("24/12/26")).toBe("2026-12-24");
    // The closest one: early January means next year's.
    expect(p("5 janvier")).toBe("2027-01-05");
    expect(p("31/02/2026")).toBeNull();
  });

  it("understands times", () => {
    expect(p("demain 9h")).toBe("2026-10-30T09:00");
    expect(p("demain à 14h30")).toBe("2026-10-30T14:30");
    expect(p("tomorrow at 2pm")).toBe("2026-10-30T14:00");
    expect(p("friday 9:15am")).toBe("2026-10-30T09:15");
    expect(p("12pm")).toBe("2026-10-29T12:00");
    expect(p("12am")).toBe("2026-10-29T00:00");
    expect(p("à midi")).toBe("2026-10-29T12:00");
    expect(p("ce soir")).toBe("2026-10-29T19:00");
    expect(p("15 novembre à 8h")).toBe("2026-11-15T08:00");
    expect(p("25h")).toBeNull();
  });

  it("understands reminders", () => {
    expect(parseNaturalDate("rappel demain 9h", now)).toEqual({ date: "2026-10-30T09:00", remind: true });
    expect(parseNaturalDate("remind me tomorrow", now)).toEqual({ date: "2026-10-30", remind: true });
    expect(parseNaturalDate("remind", now)).toEqual({ date: "2026-10-29", remind: true });
    expect(parseNaturalDate("demain", now)?.remind).toBe(false);
  });

  it("understands German, Spanish and Italian", () => {
    expect(p("heute")).toBe("2026-10-29");
    expect(p("morgen")).toBe("2026-10-30");
    expect(p("mañana")).toBe("2026-10-30");
    expect(p("domani")).toBe("2026-10-30");
    expect(p("übermorgen")).toBe("2026-10-31");
    expect(p("pasado mañana")).toBe("2026-10-31");
    expect(p("ayer")).toBe("2026-10-28");
    expect(p("am Freitag")).toBe("2026-10-30");
    expect(p("viernes")).toBe("2026-10-30");
    expect(p("venerdì")).toBe("2026-10-30");
    expect(p("nächsten Freitag")).toBe("2026-11-06");
    expect(p("el próximo viernes")).toBe("2026-11-06");
    expect(p("venerdì prossimo")).toBe("2026-11-06");
    expect(p("nächste Woche")).toBe("2026-11-02");
    expect(p("la próxima semana")).toBe("2026-11-02");
    expect(p("la settimana prossima")).toBe("2026-11-02");
    expect(p("in 3 Tagen")).toBe("2026-11-01");
    expect(p("vor 2 Tagen")).toBe("2026-10-27");
    expect(p("en 3 días")).toBe("2026-11-01");
    expect(p("dentro de una semana")).toBe("2026-11-05");
    expect(p("hace 2 días")).toBe("2026-10-27");
    expect(p("tra due settimane")).toBe("2026-11-12");
    expect(p("3 giorni fa")).toBe("2026-10-26");
    expect(p("15. November")).toBe("2026-11-15");
    expect(p("15 de noviembre de 2027")).toBe("2027-11-15");
    expect(p("1 dicembre")).toBe("2026-12-01");
    expect(p("15.11.2026")).toBe("2026-11-15");
    expect(p("morgen um 9 Uhr")).toBe("2026-10-30T09:00");
    expect(p("morgen um 14:30")).toBe("2026-10-30T14:30");
    expect(p("mañana a las 9")).toBe("2026-10-30T09:00");
    expect(p("domani alle 15")).toBe("2026-10-30T15:00");
    expect(p("heute Abend")).toBe("2026-10-29T19:00");
    expect(p("stasera")).toBe("2026-10-29T19:00");
    expect(p("a mezzogiorno")).toBe("2026-10-29T12:00");
    expect(parseNaturalDate("erinnere mich morgen", now)).toEqual({ date: "2026-10-30", remind: true });
    expect(parseNaturalDate("recuérdame el viernes", now)).toEqual({ date: "2026-10-30", remind: true });
    expect(parseNaturalDate("ricordami domani alle 9", now)).toEqual({ date: "2026-10-30T09:00", remind: true });
  });

  it("leaves other words alone", () => {
    for (const text of ["", "réunion", "maison", "15", "projet 2026", "mar", "notes de lundi", "Termin", "riunione", "reunión"]) expect(p(text)).toBeNull();
  });

  it("places reminders before the date", () => {
    expect(reminderTime("2026-10-30", 0)).toEqual(new Date(2026, 9, 30, 9, 0));
    expect(reminderTime("2026-10-30", 1440)).toEqual(new Date(2026, 9, 29, 9, 0));
    expect(reminderTime("2026-10-30T14:30", 15)).toEqual(new Date(2026, 9, 30, 14, 15));
  });
});
