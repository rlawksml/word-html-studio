# 독립 Cloudflare 스테이징 설정 검증

- 기준: 7fb85450fe16e54dceb420358bd72b04c57bd6b2 + 이 브랜치의 설정 변경
- 브랜치: codex/m1-cloudflare-staging-config
- 대상: 로컬 빌드와 dry-run만. 배포 URL 없음.
- 운영 데이터 변경 없음. 테스트 데이터 생성·정리 없음. 실제 Supabase 연결 없음.

## 실행 결과

| TC/검사 | 결과 | 증거 |
|---|---|---|
| CF-STAGE-01 식별자·공개 경로·허용 설정 | PASS | tests/cloudflare-staging-config.test.mjs |
| CF-STAGE-02 테스트 DB 고정·운영 연결 거부 | PASS | 동일 파일, 정상 staging 및 운영 URL/expected ref 변조 거부 |
| CF-STAGE-03 빌드 산출물과 설정 일치 | PASS | 동일 파일, 경로 실재·compatibility·rules 비교 |
| 관련 환경/배포 회귀 | PASS | 위 3개 포함 11/11; supabase-environment.test.mjs, deployment-target.test.mjs |
| build 및 Wrangler dry-run | PASS | npm run check:cloudflare-staging; gzip 884.15KiB, assets 28개, --dry-run: exiting now |
| lint/typecheck | PASS | npm run lint, npm run typecheck |
| diff 검사 | PASS | git diff --check |
| 실제 무료 런타임·접근 제한·P0 통합 | BLOCKED | 미배포, 비밀키 없음, 공개 경로 비활성 |
| 전체 기능 P0 회귀 | SKIPPED | 이번 단계는 설정 준비만; 배포 GO 전 별도 필수 |

## 판정

설정 준비 단계 통과. 실제 배포는 **NO-GO**이며 머지하지 않는다.

독립 리뷰 후 CI 연결 누락과 생성 바인딩 검증 누락을 보완했다. CF-STAGE-04를 추가하고 알 수 없는 비어 있지 않은 생성 설정을 거부한다. 최종 관련 회귀는 **12/12 PASS**, lint 재통과. 앞 표의 11/11은 보완 전 결과다. 원격 CI 결과는 별도 확인 대상이다.
기존 Sites manifest, Vite/build 명령, 앱 기능 코드와 DB schema는 변경하지 않았다.
API 키·암호·세션 비밀값 없음. account ID와 project ref는 대상 식별자다.

## 잔여 사항

- 무료 플랜 및 CPU 제한의 실측, 접근 보호, staging secret 등록, 버전 SHA/SITE_URL 설정
- IMAGES 미연결 경로 처리 검증
- 기존 빌드 경고: 확장자 없는 Vite config import 및 큰 클라이언트 청크
- 공개 경로 비활성은 접근 정책 구성을 대체하지 않는다. 접근 활성화 전 별도 보호 검증 필요
