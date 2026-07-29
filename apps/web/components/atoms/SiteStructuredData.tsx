import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site-metadata";

// 검색엔진이 첫 화면을 동네책방 소식 모음 페이지로 이해하도록 정적인 JSON-LD를 제공합니다.
export function SiteStructuredData() {
  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    inLanguage: "ko-KR",
    isPartOf: { "@type": "WebSite", name: SITE_TITLE, url: SITE_URL },
    about: { "@type": "Thing", name: "대한민국 동네책방 소식" },
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
