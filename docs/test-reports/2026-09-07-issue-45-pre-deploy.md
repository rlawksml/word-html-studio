# 이슈 #45 배포 전 테스트 보고서

## 판정

- 결과: `GO — owner-private Staging 배포에 한함`
- 단계: `PRE-DEPLOY`
- 작성 일시: 2026-09-07 KST
- 검증자: Codex

## 검증 대상

- 프로젝트: 동네책방 소식 스튜디오
- 환경: 로컬 production build + 분리된 Supabase Staging
- 기준 브랜치: `develop` (`1bcc5db`)
- 대상 브랜치: `codex/v1.1-draft-url-save`
- 관련 이슈: GitHub #45
- Production 영향: 코드·Sites·Supabase 변경 없음

## 변경 기능과 TC

| 변경 기능 | 영향 TC | 자동화 파일 | 배포 전 | 배포 후 |
|---|---|---|---|---|
| draft 부분 URL 저장 허용 | TC-SUB-009 | `submission-url-validation.test.mjs`, `supabase-integration.test.mjs` | 필수 | 필수 |
| 완료 URL 엄격 검증과 정확한 필드 포커스 | TC-SUB-003, TC-SUB-009 | URL 단위 테스트 + 실제 브라우저 | 필수 | 필수 |
| `www` 주소의 `https://` 보완 | TC-SUB-009 | URL 단위 테스트 + 실제 브라우저 | 필수 | 필수 |
| 구조화 API 오류와 개인정보 없는 로그 | TC-SUB-009 | URL·클라이언트 단위 테스트 + 통합 테스트 | 필수 | 로그 확인 |
| 안전하지 않은 링크 출력 차단 | TC-SUB-009 | URL 단위 테스트 + 기존 HTML 회귀 | 필수 | 스모크 |

## 결과 요약

| PASS | FAIL | BLOCKED | SKIPPED | 전체 |
|---:|---:|---:|---:|---:|
| 10 | 0 | 0 | 0 | 10 |

## TC 실행 결과

| TC ID | 우선순위 | 종류 | 결과 | 실제 결과·증거 |
|---|---|---|---|---|
| TC-SUB-009-A | P0 | 단위 | PASS | 부분 URL은 draft에서 비차단, completed에서 `INVALID_URL`로 차단 |
| TC-SUB-009-B | P0 | 단위 | PASS | `www.example.com`은 https로 보완, `https:/`은 오류로 유지 |
| TC-SUB-009-C | P0 | 단위 | PASS | 소식 1·5·10·20개에서 첫 관련 링크의 정확한 `fieldPath` 반환 |
| TC-SUB-009-D | P0 | 단위 | PASS | 위험·불완전 URL은 공개 링크용 href로 변환되지 않음 |
| TC-SUB-009-E | P0 | API/DB | PASS | Staging draft에 `https:/` 저장 성공, 완료 요청은 400·`news.0.applyUrl` 반환, 정상 URL 완료 성공 |
| TC-SUB-009-F | P0 | 브라우저 | PASS | 부분 URL 입력 후 `자동 저장됨`, 완료 시 선택 영역 유지·해당 입력 포커스·정확한 한국어 안내 |
| TC-SUB-009-G | P0 | 브라우저 | PASS | `www.example.com/apply`가 `https://www.example.com/apply`로 보완되고 완전한 URL로 완료 후 목록 복귀 |
| 전체 회귀 | P0 | 자동 | PASS | production build 포함 47/47 통과 |
| Staging 통합 회귀 | P0 | API/DB/Storage | PASS | 3/3 통과, 테스트 책방·소식·사진·잠금 자동 정리 |
| 데이터 무결성 | P0 | DB/Storage 읽기 | PASS | `RESUME_DRY_RUN_PASS`, DB 8/12/0/2행·Storage 49/49개·누락 0 |

## 실행 중 발견한 환경 문제

- 새 Git worktree에는 `node_modules`가 없어 첫 집중 테스트가 의존성 로드 전에 중단됐다. 기존 로컬 의존성 캐시를 연결한 뒤 같은 테스트가 통과했다.
- 제한된 파일 권한에서 공유 의존성의 Vite 임시 파일을 만들 수 없어 첫 전체 테스트가 빌드 시작 전에 `EPERM`으로 중단됐다. 동일 코드·동일 명령을 허용된 로컬 실행으로 재시도해 47/47 통과했다.
- 첫 로컬 서버 실행은 Staging 환경 파일을 로드하지 않아 앱이 의도한 `공용 저장소 연결 정보가 필요합니다` 화면을 표시했다. 서버를 올바른 Staging 환경으로 재시작한 뒤 브라우저 TC를 수행했다.
- 위 세 건은 제품 로직 실패나 Production 장애가 아니며, 실패 시 Staging 데이터 쓰기도 발생하지 않았다.

## 실행 명령과 환경

| 구분 | 결과 |
|---|---|
| `npm run lint` | PASS, ESLint 오류 0 |
| `npm test` | build PASS, 47/47 PASS |
| URL 집중 테스트 | 6/6 PASS |
| URL + 저장 안정화 집중 테스트 | 17/17 PASS |
| 분리된 Supabase Staging 통합 | 3/3 PASS |
| 로컬 production build + Staging 브라우저 | draft 저장·오류 포커스·보완·완료 PASS, console warn/error 0 |
| `git diff --check` | PASS |
| Staging 기준 백업 `--resume` dry-run | `RESUME_DRY_RUN_PASS` |

## 테스트 데이터 보호

- API 통합 테스트는 고유 2099년 책방·소식·사진·개선사항만 만들고 `finally`에서 정리했다.
- 브라우저 검증은 제목이 `[테스트 #45] 부분 URL 자동 저장`인 소식 한 건만 만들었다.
- 정리 전 ID·책방 ID·월·제목이 일치하는 한 건을 읽어 확인한 뒤 해당 ID와 편집 잠금만 삭제했다.
- 최종 읽기 전용 비교에서 Staging은 기준 백업과 같은 DB 8/12/0/2행, 원본 49개, 미리보기 49개였다.
- Production에는 생성·수정·삭제 요청을 보내지 않았다.

## 잔여 위험과 배포 조건

- 요청 크기는 브라우저가 `content-length`를 제공할 때만 바이트 수가 기록되며, 제공하지 않으면 `null`로 남는다. 오류 코드와 필드 경로는 항상 기록된다.
- HEIC 지연 로드 청크 크기 경고는 기존 경고이며 이번 URL 수정과 무관하다.
- owner-private Staging에서 같은 시나리오를 다시 통과하기 전 Production 승격은 `NO-GO`다.

## 결론

이슈 #45의 원인이던 draft URL 과잉 검증은 분리되었다. 부분 URL 자동 저장, 완료 차단과 정확한 포커스, `www` 보완, 정상 URL 완료, 서버 구조화 오류, 데이터 원상복구가 모두 확인되어 owner-private Staging 배포에 한해 진행할 수 있다.
