/** Profile picture, or initials on a color derived from the name. */
export function Avatar({ name, url, size = 24 }: { name: string; url: string | null | undefined; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (url) return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return (
    <span style={{ ...style, backgroundColor: `hsl(${Math.abs(hash) % 360} 55% 45%)` }} className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white">
      {initials || "?"}
    </span>
  );
}
