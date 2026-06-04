/**
 * Inspiration URL scraping utility
 * Fetches user-provided URLs and extracts design/content signals for LLM context
 */

/** Fetch a URL and extract title, sections, colors, body text */
export async function scrapeInspirationUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MariaBot/1.0; +https://mar-ia.net)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return `[${url}] → non accessible (HTTP ${res.status})`;
    const html = await res.text();

    // Title
    const title = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i)?.[1]?.trim() || "";
    // Meta description
    const metaDesc = (
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i)
    )?.[1]?.trim() || "";
    // Detect hex colors (CSS variables, inline styles)
    const colorMatches = [...html.matchAll(/#([0-9a-fA-F]{6})\b/g)]
      .map((m) => `#${m[1]}`)
      .filter((c, i, arr) => arr.indexOf(c) === i)
      .slice(0, 8)
      .join(", ");
    // Headings h1–h3
    const headings = [...html.matchAll(/<h[1-3][^>]*>\s*([^<]{1,80})\s*<\/h[1-3]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(" | ");
    // Strip tags for body text sample
    const bodyText = html
      .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/(script|style|noscript|svg)>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    return [
      `🌐 ${url}`,
      title       && `Titre: ${title}`,
      metaDesc    && `Description: ${metaDesc}`,
      headings    && `Sections/titres: ${headings}`,
      colorMatches && `Couleurs détectées: ${colorMatches}`,
      `Extrait: ${bodyText}`,
    ].filter(Boolean).join("\n");
  } catch {
    return `[${url}] → non accessible (timeout ou erreur réseau)`;
  }
}

/** Extract [INSPIRATION_URLS: url1 url2 …] block from a prompt */
export function parseInspirationUrls(prompt: string): { cleanPrompt: string; urls: string[] } {
  const match = prompt.match(/\[INSPIRATION_URLS:\s*([^\]]+)\]/);
  if (!match) return { cleanPrompt: prompt, urls: [] };
  const urls = match[1]
    .trim()
    .split(/\s+/)
    .filter((u) => /^https?:\/\/.+/.test(u))
    .slice(0, 4);
  const cleanPrompt = prompt.replace(match[0], "").trim();
  return { cleanPrompt, urls };
}

/** Build the full inspiration context string to inject into the LLM system prompt */
export async function buildInspirationContext(prompt: string): Promise<{ cleanPrompt: string; context: string }> {
  const { cleanPrompt, urls } = parseInspirationUrls(prompt);
  if (urls.length === 0) return { cleanPrompt, context: "" };

  console.log(`[Inspiration] Scraping ${urls.length} URL(s):`, urls);
  const scraped = await Promise.all(urls.map(scrapeInspirationUrl));
  const context = `\n\n══ INSPIRATION (sites analysés par Mar-ia) ══\nL'utilisateur s'inspire de ces sites. Adapte librement l'ambiance, la structure, le style visuel et les couleurs détectées — tout en restant fidèle à la description et aux paramètres du projet.\n\n${scraped.join("\n\n---\n")}`;
  console.log(`[Inspiration] Context ready (${context.length} chars)`);
  return { cleanPrompt, context };
}
