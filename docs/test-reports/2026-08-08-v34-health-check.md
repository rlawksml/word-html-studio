# 2026-08-08 운영 서비스 상태 점검 보고서

## 판정

- **결과: NO-GO**
- Sites 배포와 정적 화면은 정상이나, 공용 데이터 API가 Supabase 호스트를 찾지 못해 핵심 기능을 사용할 수 없다.
- 운영 데이터는 수정하지 않았으며 읽기 요청, 무권한 차단 요청, 브라우저 표시만 확인했다.

## 읽기 전용 재확인

- 같은 날 후속 점검에서는 사용자의 운영 데이터 보호 요청에 따라 공개 `GET` 요청, Worker 로그 조회, 로컬 lint·build·단위 회귀만 실행했다.
- 책방·소식·사진·개선사항 생성·수정·삭제, 로그인 제출, 잘못된 권한 요청, Supabase 통합 테스트, reset·cleanup은 실행하지 않았다.
- `/api/workspace`와 `/api/improvements`의 HTTP 500 및 Cloudflare `1016`이 동일하게 재현됐다.
- lint와 production build는 다시 통과했고 회귀 테스트는 동일하게 24/25 통과했다. 실패 1건은 `2026년 7월` 고정 기대값이다.
- **운영 데이터 변경 없음**을 확인했다.

## 점검 대상

- 운영 URL: `https://bookstore-news-studio.rlawksml.chatgpt.site/`
- Sites 프로젝트 상태: `active`, 공개 접근
- 운영 버전: Sites v34
- 운영 소스 커밋: `28efad2`
- GitHub `main`: `3affe71`
  - 운영 커밋 이후 차이는 테스트 문서와 배포 후 보고서뿐이므로 앱 코드는 동일하다.

## 결과 요약

| 영역 | 결과 | 증거 |
|---|---|---|
| 배포·공개 접근 | PASS | Sites v34 활성, 홈 HTTP 200 |
| 정적 화면·문서 | PASS | `/`, `/help`, `/improvements`, robots, sitemap, manifest, OG 이미지, PDF 가이드, `/favicon.svg` HTTP 200 |
| 공용 책방 데이터 | **FAIL** | `/api/workspace` HTTP 500, `공용 저장소에서 데이터를 불러오지 못했습니다.` |
| 개선사항 데이터 | **FAIL** | `/api/improvements` HTTP 500, 화면에 불러오기 실패 안내 표시 |
| Supabase 연결 | **FAIL** | 설정 호스트가 Cloudflare DNS와 Google DNS에서 모두 NXDOMAIN(Status 3), 로컬 `curl`도 호스트 해석 실패 |
| 실패 UX | PASS | 3회 자동 확인 후 연결 오류와 `다시 불러오기` 버튼 표시 |
| 모바일 실패 UX | PASS | 390×844에서 로딩·오류 카드가 화면 안에 정상 표시 |
| 무권한 차단 | PASS | 잘못된 로그인 401, 무권한 소식 401, 사진 403, 편집 상태 401 |
| lint | PASS | `npm run lint` 통과 |
| production build | PASS | `vinext build` 통과, HEIC 지연 청크 용량 경고만 존재 |
| 자동 회귀 | **FAIL** | 25건 중 24건 통과, 1건이 `2026년 7월` 고정 기대값 때문에 8월에 실패 |
| 운영 쓰기·사진 통합 | SKIPPED | 장애 중인 운영 데이터 보호를 위해 생성·수정·삭제 테스트를 실행하지 않음 |

## HTTP 스모크

| 경로 | 상태 | 비고 |
|---|---:|---|
| `/` | 200 | HTML 정상 |
| `/help` | 200 | 가이드 화면 정상 |
| `/improvements` | 200 | 화면은 열리지만 데이터 조회 실패 안내 |
| `/api/workspace` | **500** | 핵심 장애 |
| `/api/improvements` | **500** | Supabase 의존 기능 장애 |
| `/robots.txt` | 200 | 정상 |
| `/sitemap.xml` | 200 | 정상 |
| `/manifest.webmanifest` | 200 | 정상 |
| `/og-bookstore-news.png` | 200 | 1,221,753 bytes |
| `/guides/bookstore-news-input-guide.pdf` | 200 | 553,195 bytes |
| `/favicon.svg` | 200 | 문서에서 설정한 아이콘 정상 |
| `/favicon.ico` | 404 | 일부 브라우저 기본 요청에서 발생하는 비차단 경고 |

## 원인 분석

Worker 로그에서 `/api/workspace` 요청에 Cloudflare 오류 코드 `1016`이 기록됐다. 배포 환경과 로컬 환경의 `SUPABASE_URL`은 같은 호스트를 가리키지만, 해당 호스트는 두 공용 DNS에서 모두 존재하지 않는 주소로 응답했다.

따라서 현재 장애는 프런트 화면이나 재시도 코드보다 **설정된 Supabase 프로젝트 주소가 더 이상 DNS에 존재하지 않는 것**이 직접 원인이다. Supabase 프로젝트가 중지·삭제됐거나 프로젝트 URL이 변경됐을 가능성이 있으나, 정확한 프로젝트 상태는 Supabase 대시보드에서 확인해야 한다.

## 추가 발견

1. `tests/rendered-html.test.mjs`의 공개 달력 테스트가 `2026년 7월`을 고정 검사한다. 현재 한국 시간 기준 초기 월은 2026년 8월이어서 회귀 테스트가 1건 실패한다. 테스트 기준 월을 주입하거나 현재 월과 독립적으로 만들어야 한다.
2. Sites에는 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, 역할별 작업 암호가 등록돼 있다. `WORKSPACE_SESSION_SECRET`은 별도로 등록되지 않아 현재 코드는 Supabase 비밀키를 세션 서명 키로 대체 사용한다. 동작에는 문제가 없지만 키 역할을 분리하는 편이 안전하다.
3. `/favicon.svg`는 정상이나 `/favicon.ico`가 없어 Worker 로그에 404가 쌓인다. 핵심 장애와 무관한 후속 정리 항목이다.

## 복구 순서

1. Supabase 대시보드에서 `bookstore-news-studio` 프로젝트가 존재하고 실행 중인지 확인한다.
2. 같은 프로젝트를 복구할 수 있으면 DNS가 다시 생긴 뒤 `/api/workspace`가 200인지 확인한다.
3. 프로젝트가 삭제됐거나 새 프로젝트로 바뀌었다면 새 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY`를 로컬·Sites 환경에 함께 반영하고 SQL 마이그레이션과 Storage 버킷을 확인한다.
4. 독립적인 `WORKSPACE_SESSION_SECRET`을 Sites에 추가한다.
5. 날짜 고정 자동 테스트를 수정한다.
6. lint, build, 25개 회귀 테스트, 실제 Supabase 통합 테스트와 전체 P0 TC를 다시 실행한다.
7. `/api/workspace`, 로그인, 책방 저장, 자동 저장, JPEG·HEIC 업로드, HTML 다운로드를 운영에서 재검증한 뒤 GO를 판정한다.

같은 Supabase 프로젝트가 단순 복구되어 URL과 키가 유지된다면 앱 코드 재배포 없이 서비스가 회복될 수 있다. URL·키·스키마 또는 앱 코드가 바뀌면 환경 갱신과 재배포 후 배포 후 TC를 다시 수행한다.
