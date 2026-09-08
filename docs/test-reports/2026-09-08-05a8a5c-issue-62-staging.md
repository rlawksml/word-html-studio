# 이슈 #62 운영 의존성 보안 업데이트 검증 보고서

## 판정

- 결과: `GO`
- 단계: `STAGING`
- 작성 일시: 2026-09-08 (KST)
- 검증자: Codex

## 검증 대상

- 프로젝트: 동네책방 소식 스튜디오
- 환경: Local, GitHub Actions PR, GitHub `staging` Environment, owner-private Sites Staging
- 기준 브랜치: `develop` (`03af885`)
- 대상 브랜치: `codex/v1.1-runtime-security`
- 기능 커밋 SHA: `05a8a5c1d935338e075a3bb33f153c564d83b80c`
- Sites Staging 소스 SHA: `f669f56da35d7799221abd879677667cf0eebf39`
- Sites Staging 버전: 11
- PR: [#63](https://github.com/rlawksml/word-html-studio/pull/63)
- 관련 이슈: [#62](https://github.com/rlawksml/word-html-studio/issues/62)
- Production 배포: 없음

## 변경 기능과 TC

| 변경 기능 | 영향 TC | 자동화 파일 | 배포 전 | 배포 후 |
|---|---|---|---|---|
| Next.js·React Server Components 보안 패치 | TC-SEC-001 | `apps/web/tests/deployment-target.test.mjs` | 필수 | Staging 화면·API 통합 |
| 운영 의존성 high 이상 취약점 CI 차단 | TC-SEC-001 | `.github/workflows/ci.yml` | 필수 | GitHub Actions 실제 실행 |
| 기존 기능·DB 격리·정리 안전장치 유지 | 전체 회귀, TC-DR-005~011 | 기존 자동·통합 테스트 | 필수 | Staging 통합 3/3 |

## 결과 요약

| PASS | FAIL | BLOCKED | SKIPPED | 전체 |
|---:|---:|---:|---:|---:|
| 9 | 0 | 0 | 0 | 9 |

## TC 실행 결과

| TC ID | 우선순위 | 종류 | 결과 | 실제 결과·증거 | 비고 |
|---|---|---|---|---|---|
| TC-SEC-001 | P0 | 운영 audit | PASS | 변경 전 high 4건 → 변경 후 0건 | `npm audit --omit=dev --audit-level=high` |
| TC-SEC-001 | P0 | 버전 검증 | PASS | Next 16.3.4, React·React DOM·RSC 19.2.8 | 보안 수정 버전 이상 |
| TC-SEC-001 | P0 | CI gate 회귀 | PASS | 집중 테스트 4/4 | workflow와 package script 삭제·우회 방지 |
| 전체 회귀 | P0·P1 | Local·CI | PASS | production build 포함 74/74 | 기존 73건 + 신규 1건 |
| lint | 필수 | Local·CI | PASS | ESLint 오류 없음 | |
| migration·배포 대상 | P0 | Local·CI | PASS | additive migration 정책·Staging 대상 통과 | |
| Supabase 통합 | P0 | 실제 Staging | PASS | [실행 34198411959](https://github.com/rlawksml/word-html-studio/actions/runs/34198411959) 3/3 | 정확한 QA 키·파일 정리 포함 |
| 공개 Staging | P0 | 브라우저 읽기 | PASS | 2026년 9월 3개 책방·3개 소식 유지, 도움말·개선사항 정상 | QA 데이터 노출 없음 |
| Worker 로그 | P1 | 배포 후 | PASS | 서버 예외 0건 | 브라우저 이동 중 취소 3건은 서버 오류가 아님 |

## 원인과 수정

운영 번들에 포함되는 Next.js, React Server Components, PostCSS, Sharp, nanoid 의존성에 high 등급 취약점 4건이 남아 있었다. 특히 [Next.js SSRF 권고](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)는 16.2.11 미만, [React Server Components DoS 권고](https://github.com/advisories/GHSA-wx67-qw84-cm4g)는 React 19.2.8 미만을 영향 범위로 명시한다.

Next.js를 16.3.4, React·React DOM·`react-server-dom-webpack`을 19.2.8로 올리고 lockfile의 PostCSS·Sharp·nanoid를 수정 버전으로 갱신했다. Next.js 16 안의 patch/minor 업데이트이므로 프레임워크 codemod가 필요한 API 변경은 없으며, [Next.js 16 공식 업그레이드 문서](https://nextjs.org/docs/app/guides/upgrading/version-16)의 수동 패키지 업데이트 절차를 적용했다.

한 번 수정하고 끝나는 문제를 막기 위해 `audit:production` 명령을 추가하고 GitHub Actions `verify`가 매 실행마다 운영 의존성 high 이상을 검사하도록 했다. 회귀 테스트는 이 gate나 package script가 빠지면 실패한다.

## 실행 명령과 환경

| 구분 | 명령·환경 | 결과 |
|---|---|---|
| clean install | `npm ci` | PASS |
| 운영 audit | `npm run audit:production` | high 0, 전체 0 |
| 집중 | `node --test tests/deployment-target.test.mjs` | 4/4 PASS |
| build·unit | `npm test` | build·74/74 PASS |
| lint | `npm run lint` | PASS |
| migration | `npm run migration:check` | PASS |
| integration | GitHub workflow dispatch, `staging` Environment | 3/3 PASS |
| Sites | owner-private Staging 버전 11 | 배포 성공 |

## 테스트 데이터와 운영 보호

- GitHub 통합 테스트는 고유한 2099년 QA 키와 Storage 경로만 생성·정리했다.
- #60에서 추가한 정확한 키·경로 잔여 0건 검증을 통과했다.
- Staging 공개 데이터는 배포 전후 모두 3개 책방·3개 소식으로 유지됐다.
- Production 앱·Sites·Supabase Database·Storage에는 읽기·쓰기·배포를 수행하지 않았다.
- `main`은 기존 운영 SHA를 그대로 유지한다.

## 경고와 잔여 위험

- 개발·빌드 도구까지 포함한 전체 `npm audit`에는 19건(낮음 1, 보통 5, 높음 13)이 남는다. 운영 번들 취약점은 0건이며, 남은 항목은 위험한 강제 업데이트를 피하기 위해 별도 이슈에서 도구별로 분리한다.
- owner-private Staging의 최근 로그에 브라우저 reload·이동 중 취소된 `/api/workspace` 요청 3건이 기록됐지만, `level=info`, `error=null`이고 Worker 예외는 0건이다.
- Windows Edge UAT와 v1.1 전체 Production 릴리스 게이트는 #48에서 계속 진행한다.

## 최종 결론

- 판정 근거: 운영 audit 0, 전체 74/74, lint·migration, 실제 Supabase Staging 3/3, Sites Staging v11 화면과 Worker 로그 검증을 모두 통과했다.
- 배포 가능 여부: `develop` 병합 `GO`; Production 배포는 #48의 명시적 승인 전 `NO-GO`.
- 병합 후 재확인: `develop`의 정확한 병합 SHA에서 같은 GitHub workflow를 다시 실행한다.
