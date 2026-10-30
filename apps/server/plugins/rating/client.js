// A "Rating" column type: the cell keeps "1" to "5"; clicking the current rating again clears it.
export function activate(nootion) {
  const h = nootion.React.createElement;
  const label = (n) => (nootion.locale === "fr" ? `${n} sur 5` : `${n} out of 5`);

  function Stars({ value, setValue, editable }) {
    const rating = Math.max(0, Math.min(5, Number(value) || 0));
    const [hover, setHover] = nootion.React.useState(0);
    const shown = hover || rating;
    return h(
      "span",
      { role: editable ? "radiogroup" : "img", "aria-label": label(rating), style: { display: "inline-flex", gap: "1px" }, onMouseLeave: () => setHover(0) },
      [1, 2, 3, 4, 5].map((n) =>
        editable
          ? h(
              "button",
              {
                key: n,
                type: "button",
                role: "radio",
                "aria-checked": n === rating,
                "aria-label": label(n),
                onMouseEnter: () => setHover(n),
                onClick: (e) => {
                  e.stopPropagation();
                  setValue(n === rating ? null : String(n));
                },
                style: { background: "none", border: 0, padding: "0 1px", cursor: "pointer", fontSize: "15px", lineHeight: 1, opacity: n <= shown ? 1 : 0.25 },
              },
              "⭐",
            )
          : n <= rating
            ? h("span", { key: n, style: { fontSize: "15px", lineHeight: 1 } }, "⭐")
            : null,
      ),
    );
  }

  nootion.registerPropertyType("stars", { Cell: Stars });
}
