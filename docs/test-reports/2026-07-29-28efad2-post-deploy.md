# 배포 후 테스트 보고서

## 판정

- 결과: `PASS`
- 단계: `POST-DEPLOY`
- 작성 일시: 2026-07-29 (KST)
- 운영 커밋: `28efad2`
- Sites 버전: `34`
- 운영 주소: `https://bookstore-news-studio.rlawksml.chatgpt.site/`

## 배포 결과

- Sites 배포 상태: `succeeded`
- 공개 사이트가 버전 34로 전환됐다.
- 환경변수 revision이 적용됐고 Supabase 공개 읽기 API가 기존 데이터를 정상 반환했다.
- 운영 API 응답: 책방 7곳, 월별 Submission 4건

## 운영 스모크 테스트

| 경로 | 기대 결과 | 실제 결과 |
|---|---|---|
| `/` | 공개 홈과 메타데이터 | HTTP 200 |
| `/help` | 사용자 가이드 | HTTP 200 |
| `/improvements` | 개선사항 접수 | HTTP 200 |
| `/api/workspace` | Supabase 공개 데이터 | HTTP 200 |
| `/robots.txt` | 검색 수집 규칙 | HTTP 200 |
| `/sitemap.xml` | 공개 URL 목록 | HTTP 200 |
| `/manifest.webmanifest` | 웹 앱 정보 | HTTP 200 |
| `/og-bookstore-news.png` | 1200×630 공유 이미지 | HTTP 200, `image/png` |

운영 홈 HTML에서 다음 항목을 확인했다.

- 운영 주소 canonical
- Open Graph 제목·설명·이미지
- Twitter Card
- `CollectionPage` JSON-LD
- manifest 연결
- 수정된 브랜드 버튼과 별도 작업자 지연 로드 청크

## 운영 Lighthouse

모바일 조건으로 운영 주소를 연속 3회 측정했다.

| 실행 | 성능 | 접근성 | 모범 사례 | SEO | FCP | LCP | TBT | CLS |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 70 | 100 | 81 | 100 | 1.8s | 2.9s | 980ms | 0.001 |
| 2 | 76 | 100 | 81 | 100 | 1.6s | 2.5s | 890ms | 0 |
| 3 | 74 | 100 | 81 | 100 | 1.5s | 2.6s | 990ms | 0 |
| 중앙값 | 74 | 100 | 81 | 100 | 1.6s | 2.6s | 980ms | 0 |

### 변경 전후

| 지표 | 변경 전 운영 기준점 | 변경 후 운영 중앙값 |
|---|---:|---:|
| 성능 | 67 | 74 |
| 접근성 | 89 | 100 |
| 모범 사례 | 81 | 81 |
| SEO | 100 | 100 |
| TBT | 1,230ms | 980ms |
| 사용하지 않는 JavaScript 예상량 | 56KB | 24KB |

## 남은 플랫폼 영향

- 운영 TBT의 대부분은 Cloudflare의 `/cdn-cgi/challenge-platform/scripts/jsd/main.js`가 사용한 약 1.88초의 스크립트 평가 시간이다.
- 모범 사례의 deprecated API 경고 3건도 모두 같은 Cloudflare 보안 스크립트에서 발생했다.
- 앱 자체 production build에서는 TBT 0~10ms, 접근성·모범 사례·SEO가 모두 100이었다.
- Cloudflare 보안 계층은 Sites 운영 환경에서 주입되므로 애플리케이션 저장소 코드로 제거할 수 없다.

## 회귀와 데이터 안전

- 배포 전 `npm test`: 25/25 통과
- 배포 전 실제 Supabase 통합 테스트: 3/3 통과 및 테스트 데이터 정리
- 배포 후에는 운영 데이터를 변경하지 않고 공개 읽기와 SEO 자산만 확인했다.
- 실제 작업 암호, Supabase 비밀키와 환경변수 값은 보고서에 기록하지 않았다.

## 최종 결론

- 배포와 핵심 공개 경로가 정상이며 SEO·접근성 개선이 운영 환경에 반영됐다.
- 앱이 제어할 수 있는 JavaScript와 접근성 문제는 개선됐다.
- 성능 중앙값은 67에서 74로 올랐고, 잔여 TBT와 모범 사례 경고는 Cloudflare 보안 스크립트 영향으로 분리해 추적한다.
