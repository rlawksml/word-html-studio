import { SITE_URL } from "@/lib/site-metadata";

// vinext·Cloudflare에서도 확실히 노출되도록 Metadata Route 대신 명시적인 공개 응답을 사용합니다.
export async function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /improvements",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    `Host: ${SITE_URL}`,
  ].join("\n");

  return new Response(`${body}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
