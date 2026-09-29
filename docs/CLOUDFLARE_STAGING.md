# 독립 Cloudflare 스테이징 — 준비 단계

사용자 요청: 무료 플랜만 사용하며 운영 Sites와 운영 Supabase를 변경하지 않는다.
기존 Sites 소스 bootstrap 제약의 대안으로 별도 Worker를 준비한다. 기존 Vite 설정과 Sites manifest는 유지한다.

`apps/web/wrangler.staging.json`은 명시적으로 선택할 때만 사용한다. `workers_dev`, preview URL과 routes가 모두 꺼져 있어 접근 보호를 설정하기 전에는 공개되지 않는다. ASSETS 외 Cloudflare 리소스를 연결하지 않는다. 이 파일은 요금제를 설정하는 파일이 아니므로 실제 배포 전 계정의 Workers Free 플랜을 별도 확인해야 한다.

검증 명령 (apps/web): `npm run check:cloudflare-staging`

빌드 → CF-STAGE-01~03 테스트 → dry-run만 수행한다. 업로드·DB 접속·데이터 쓰기를 하지 않는다. 생성된 기본 dist/server/wrangler.json으로 직접 배포하지 않는다.

## 남은 게이트

- Workers Free 확인 및 요청당 CPU 제한 내 로그인/저장/SSR 측정
- 무료 접근 제한 준비 후 공개 경로 활성화 검토 (현재 외부 테스트 불가)
- 테스트 Supabase secret, 작업 암호, 세션 secret을 서버에만 등록; 운영 secret 복사 금지
- APP_COMMIT_SHA 및 SITE_URL을 실제 배포 버전/주소로 설정
- /_vinext/image의 미설정 IMAGES 경로 처리 확인 (현재 앱은 next/image 미사용)
- 전체 P0 회귀 및 격리 Supabase 통합 검증

아직 배포 승인 판정은 NO-GO다. 무료 플랜에서 불가능하면 중단하고 대안을 논의한다. 유료 전환·운영 merge·DB 복원은 수행하지 않는다.
