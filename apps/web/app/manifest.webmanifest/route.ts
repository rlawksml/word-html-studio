import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site-metadata";

export async function GET() {
  return Response.json({
    name: SITE_TITLE,
    short_name: "동네책방 소식",
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#292c2a",
    lang: "ko",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  }, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
