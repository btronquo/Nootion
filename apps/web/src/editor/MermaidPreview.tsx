import { useEffect, useState } from "react";
import { t } from "@nootion/shared";
import { drawMermaid, useDarkTheme, type Drawn } from "./mermaid";

/** Typing pauses this long before the diagram is drawn again. */
const DELAY = 250;

function useDrawn(source: string, dark: boolean, wanted: boolean): Drawn | null {
  const [drawn, setDrawn] = useState<{ source: string; result: Drawn } | null>(null);
  useEffect(() => {
    if (!wanted || !source.trim()) return;
    let current = true;
    // The first drawing comes at once; later ones wait for a pause in typing.
    const timer = setTimeout(() => void drawMermaid(source, dark).then((result) => current && setDrawn({ source, result })), drawn ? DELAY : 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `drawn` only says whether to wait
  }, [source, dark, wanted]);
  return wanted && source.trim() ? (drawn?.result ?? null) : null;
}

/**
 * The diagram of a Mermaid code block. While its source has a mistake, the last good drawing stays, faded, with the
 * message under it. The light drawing is always made, so that printing (which takes the dark theme off at once) never
 * waits for it; the dark one only in the dark theme.
 */
export function MermaidPreview({ source, onEdit }: { source: string; onEdit?: () => void }) {
  const dark = useDarkTheme();
  const light = useDrawn(source, false, true);
  const night = useDrawn(source, true, dark);
  const [lastGood, setLastGood] = useState<{ light?: string; dark?: string }>({});

  useEffect(() => {
    if (light && "svg" in light) setLastGood((g) => (g.light === light.svg ? g : { ...g, light: light.svg }));
  }, [light]);
  useEffect(() => {
    if (night && "svg" in night) setLastGood((g) => (g.dark === night.svg ? g : { ...g, dark: night.svg }));
  }, [night]);

  if (!source.trim()) {
    return (
      <div className="mermaid-preview mermaid-empty" contentEditable={false}>
        {t("mermaid.empty")}
      </div>
    );
  }

  const shown = dark ? night : light;
  const error = shown && "error" in shown ? (shown.line ? t("mermaid.errorLine", { line: shown.line }) : t("mermaid.error", { message: shown.error })) : null;
  const lightSvg = light && "svg" in light ? light.svg : lastGood.light;
  const darkSvg = night && "svg" in night ? night.svg : lastGood.dark;
  const waiting = !lightSvg && !darkSvg && !error;

  return (
    <div className="mermaid-preview" contentEditable={false} data-error={error ? "" : undefined}>
      {waiting && <p className="mermaid-message">{t("mermaid.loading")}</p>}
      {(lightSvg || darkSvg) && (
        <div
          className={`mermaid-diagram ${error ? "opacity-40" : ""} ${onEdit ? "cursor-text" : ""}`}
          onClick={onEdit}
          role="img"
          aria-label={t("mermaid.diagram")}
        >
          {/* Mermaid's output, sanitised by Mermaid itself in strict mode. */}
          {lightSvg && <div className={darkSvg ? "mermaid-light" : undefined} dangerouslySetInnerHTML={{ __html: lightSvg }} />}
          {darkSvg && <div className="mermaid-dark" dangerouslySetInnerHTML={{ __html: darkSvg }} />}
        </div>
      )}
      {error && (
        <p className="mermaid-message mermaid-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
