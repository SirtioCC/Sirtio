// Satori (the engine behind next/og's ImageResponse) needs real font
// binary data -- it can't use next/font or a browser @font-face the way
// normal pages do, and it doesn't support WOFF2 (what Google's css2
// endpoint serves to any modern browser by default), only TTF/OTF/WOFF.
// Requesting with an old-enough User-Agent makes Google fall back to a
// format Satori can actually parse -- confirmed live against the real
// endpoint: a Chrome-30-era UA gets `format('woff')` (plain WOFF1,
// which Satori's opentype.js parser reads directly), while an
// actually-ancient IE6 UA gets EOT instead, a wrapped format Satori
// can't read at all despite also being "old." Anything from
// roughly-2013-era or older works; this one was verified directly.
//
// `text`, when passed, subsets the request to only the characters
// actually needed (Google's `text=` param) -- smaller payload, and
// avoids requesting glyphs this image will never render.
const LEGACY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/30.0.0.0 Safari/537.36";

export async function loadGoogleFont(
  family: string,
  weight: number,
  text?: string
): Promise<ArrayBuffer | null> {
  try {
    const params = new URLSearchParams({ family: `${family}:wght@${weight}` });
    if (text) params.set("text", text);
    const cssRes = await fetch(`https://fonts.googleapis.com/css2?${params.toString()}`, {
      headers: { "User-Agent": LEGACY_USER_AGENT },
    });
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const match = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype|woff)'\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    // Share-card images should degrade to Satori's default font rather
    // than fail the whole image on a transient Google Fonts hiccup --
    // callers treat a null return as "fall back," not an error.
    return null;
  }
}
