# 독립 Cloudflare 스테이징 — 준비 단계

2026-09-29: 무료 계정에서 비공개 최초 업로드를 시도했으나 Cloudflare 이메일 미인증(10034)으로 Worker 생성이 차단됐다. 정적 asset 업로드만 진행됐고 완성된 배포는 없다. [실행 기록](test-reports/2026-09-29-staging-bootstrap.md).

사용자 요청: 무료 플랜만 사용하며 운영 Sites와 운영 Supabase를 변경하지 않는다.
기존 Sites 소스 bootstrap 제약의 대안으로 별도 Worker를 준비한다. 기존 Vite 설정과 Sites manifest는 유지한다.

`apps/web/wrangler.staging.json`은 명시적으로 선택할 때만 사용한다. `workers_dev`, preview URL과 routes가 모두 꺼져 있어 접근 보호를 설정하기 전에는 공개되지 않는다. ASSETS 외 Cloudflare 리소스를 연결하지 않는다. 이 파일은 요금제를 설정하는 파일이 아니므로 실제 배포 전 계정의 Workers Free 플랜을 별도 확인해야 한다.

검증 명령 (apps/web): `npm run check:cloudflare-staging`

빌드 → `test:staging-worker`(설정·gate·assets 단위 및 로컬 Miniflare/workerd 통합) → dry-run만 수행한다. 업로드·DB 접속·데이터 쓰기를 하지 않는다. 로컬 통합 검증은 임의 loopback 포트를 사용하고 외부 fetch는 차단한다. 생성된 기본 dist/server/wrangler.json으로 직접 배포하지 않는다.

## 스테이징 입장 보호 (로컬 구현 단계)

기존 Sites 및 역할별 앱 인증은 변경하지 않는다. 별도 Worker 진입점이 화면/API/정적 파일 전에 인증하며 `assets.run_worker_first: true`로 정적 파일 우회를 막는다. 공개 경로는 계속 꺼둔다.

인증 후 `/assets/` GET·HEAD만 `staging-assets.mjs`가 ASSETS 바인딩으로 전달한다. 기존 서버 앱은 생성된 JS/CSS bundle을 직접 제공하지 않아 adapter 없이는 인증 후 404가 발생했다. ASSETS의 정확한 404만 body를 해제하고 앱에 넘기며, 다른 상태는 보존한다. 바인딩 누락/예외는 generic 503이다. API·페이지·public 파일은 기존 앱 라우팅을 유지하며, favicon/PDF 경로도 로컬 엔진에서 검증했다. gate가 항상 최외곽이므로 정적 응답도 쿠키 제거·no-store·noindex 정책을 따른다.

배포 시 별개의 고엔트로피 `STAGING_ACCESS_PASSWORD`(최소 16자)와 `STAGING_SESSION_SECRET`(최소 32자)가 필요하다. 기존 역할 암호·세션 secret을 재사용하지 않는다. 실제 값은 소스/보고서/GitHub에 넣지 않는다. HTTP 전송과 설정 누락은 거부한다.

로그인은 `/__staging/login`, 입장 세션 종료는 `/__staging/logout`이다. 세션은 host-bound 서명 쿠키로 8시간 유효하며 브라우저 종료 시 사라지는 것을 보장하지 않는다. 로그아웃은 해당 브라우저 쿠키를 지운다. 복사·탈취된 토큰의 개별 서버 폐기는 지원하지 않으므로 사고 시 별도 서명 secret 교체로 전체 입장 세션을 무효화해야 한다.

로그인 제한 바인딩은 location별 eventual-consistent 방식이며 전 세계 단일 카운터가 아니다. IP를 공유하는 테스트 인원도 제한을 함께 받을 수 있다. 바인딩 이용 가능성과 무료 조건은 실제 배포 전 다시 확인한다. 이 설정만으로 요금제를 가입하거나 변경하지 않는다.

Supabase의 직접 공개 미리보기 URL은 이 gate 범위 밖이다. 실제 이미지와 원본 권한 검증 전에는 배포 GO로 판정하지 않는다. 사진 정리 합의는 [사진 보관 정책](PHOTO_RETENTION.md)에 있으며 삭제 구현/실행은 하지 않는다.

## 남은 게이트

- Workers Free 확인 및 요청당 CPU 제한 내 로그인/저장/SSR 측정
- 무료 접근 제한 준비 후 공개 경로 활성화 검토 (현재 외부 테스트 불가)
- 테스트 Supabase secret, 작업 암호, 세션 secret을 서버에만 등록; 운영 secret 복사 금지
- APP_COMMIT_SHA 및 SITE_URL을 실제 배포 버전/주소로 설정
- /_vinext/image의 미설정 IMAGES 경로 처리 확인 (현재 앱은 next/image 미사용)
- 전체 P0 회귀 및 격리 Supabase 통합 검증

아직 배포 승인 판정은 NO-GO다. 무료 플랜에서 불가능하면 중단하고 대안을 논의한다. 유료 전환·운영 merge·DB 복원은 수행하지 않는다.
