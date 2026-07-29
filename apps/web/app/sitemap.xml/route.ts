import { SITE_URL } from "@/lib/site-metadata";

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (character) => ({
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "'": "&apos;",
  "\"": "&quot;",
})[character] ?? character);

export async function GET() {
  const urls = [
    { location: SITE_URL, frequency: "monthly", priority: "1.0" },
    { location: `${SITE_URL}/help`, frequency: "monthly", priority: "0.5" },
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((item) => `  <url><loc>${escapeXml(item.location)}</loc><changefreq>${item.frequency}</changefreq><priority>${item.priority}</priority></url>`).join("\n")}\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
