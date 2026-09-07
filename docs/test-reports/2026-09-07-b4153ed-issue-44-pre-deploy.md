# 이슈 #44 배포 전 테스트 보고서

## 판정

- 결과: `GO — owner-private Staging 배포에 한함`
- 단계: `PRE-DEPLOY`
- 작성 일시: 2026-09-07 KST
- 검증자: Codex

## 검증 대상

- 프로젝트: 동네책방 소식 스튜디오
- 환경: 로컬 production build + 분리된 Supabase Staging
- 기준 브랜치: `develop` (`06c5e54`)
- 대상 브랜치: `codex/v1.1-final-korean-save`
- 기능 커밋 SHA: `b4153ed`, 브라우저 검증 보완 `ad5bb76`
- 배포 버전: Staging 배포 전
- Production 영향: 코드·Sites·Supabase 변경 없음

## 변경 기능과 TC

| 변경 기능 | 영향 TC | 자동화 파일 | 배포 전 | 배포 후 |
|---|---|---|---|---|
| 최신 ref에서 완료 스냅샷 생성 | TC-SUB-008 | `tests/submission-completion.test.mjs` | 필수 | 필수 |
| IME 조합 확정 전 완료 차단 | TC-SUB-008 | `tests/rendered-html.test.mjs` + 실제 브라우저 | 구조 검증 | 실제 입력 필수 |
| 요청·서버 응답 본문 일치 검증 | TC-SUB-004, TC-SUB-008 | `tests/submission-completion.test.mjs` | 필수 | 필수 |
| 한글·상세·선택 입력 DB 왕복 | TC-SUB-004, TC-SUB-008 | `tests/supabase-integration.test.mjs` | 필수 | 읽기 재확인 |

## 결과 요약

| PASS | FAIL | BLOCKED | SKIPPED | 전체 |
|---:|---:|---:|---:|---:|
| 8 | 0 | 0 | 0 | 8 |

## TC 실행 결과

| TC ID | 우선순위 | 종류 | 결과 | 실제 결과·증거 | 비고 |
|---|---|---|---|---|---|
| TC-SUB-008-A | P0 | 단위 | PASS | 이전 렌더 `신규모`와 최신 ref `신규모집`을 분리해 최신 값으로 완료됨 | 5개 집중 테스트 포함 |
| TC-SUB-008-B | P0 | 단위 | PASS | 서버 응답에서 마지막 한글 또는 선택 입력이 다르면 예외 발생 | URL·저장 시각 제외 기준 확인 |
| TC-SUB-008-C | P0 | 구조 회귀 | PASS | composition capture, 포인터 blur, 최신 ref 및 응답 비교 호출 확인 | 실제 IME는 배포 후 재확인 |
| TC-SUB-008-D | P0 | 브라우저+DB | PASS | `신규모` 입력 직후 `집완료`를 연속 입력하고 바로 마무리해 목록 복귀, DB 제목 `신규모집완료`·상세 마지막 글자 일치 | 전용 QA 레코드만 사용 후 삭제 |
| TC-SUB-004 | P0 | Supabase 통합 | PASS | 제목·상세·신청 방법·추가 항목 한글이 Staging DB 왕복 후 정확히 일치 | 고유 2099년 테스트 데이터 사용 |
| P0 전체 회귀 | P0 | 자동 | PASS | production build 포함 40/40 통과 | 기존 저장·사진·권한 테스트 포함 |
| Staging 통합 회귀 | P0 | API/DB/Storage | PASS | 3/3 통과, 테스트 레코드·사진·임대 정리 | Production 연결 차단 변수 사용 |
| 데이터 무결성 | P0 | DB/Storage 읽기 | PASS | `RESUME_DRY_RUN_PASS`, DB 8/12/0/2행·Storage 49/49개 해시 일치 | 잔여 테스트 데이터 0 |

## 실패·차단 상세

최종 코드 기준 제품 결함으로 판정한 실패나 차단 항목은 없다.

첫 브라우저 검증에서는 제목과 상세가 DB에 온전히 저장됐지만 편집 화면에 남는 현상이 확인됐다. 서버가 `completedAt`을 `Z` 대신 `+00:00`으로 돌려주고, PostgreSQL JSONB가 객체 키 순서를 바꾸는 정상 동작을 본문 불일치로 오인한 것이 원인이었다. 먼저 실패하는 회귀 테스트를 추가한 뒤 저장·완료·게시 시각 표기와 객체 키 순서만 비교에서 제외했다. 배열 순서와 실제 제목·상세·선택 입력은 계속 엄격히 비교한다. 보완 후 같은 브라우저 시나리오와 DB 조회가 모두 통과했다.

첫 Supabase 통합 실행은 격리 실행 환경의 DNS 차단으로 3건이 실패했다. 요청이 Staging에 도달하지 않아 테스트 데이터는 생성되지 않았다. 네트워크가 허용된 동일 명령으로 다시 실행해 3/3 통과했고, 이후 전체 백업 해시 비교로 잔여 데이터가 없음을 확인했다. 이는 애플리케이션 실패가 아니라 검증 실행 환경 제한으로 기록한다.

## 실행 명령과 환경

| 구분 | 명령·환경 | 결과 |
|---|---|---|
| lint/type | `npm run lint` | PASS |
| build/unit | `npm test` | build PASS, 40/40 PASS |
| focused unit | `node --test tests/submission-completion.test.mjs` | 5/5 PASS |
| integration | 분리된 Supabase Staging의 `tests/supabase-integration.test.mjs` | 3/3 PASS |
| browser/db | 로컬 production build + Supabase Staging 전용 QA 레코드 | 즉시 완료 후 목록 복귀, 제목·상세 정확히 일치 |
| integrity | 백업 복원 도구 `--resume` dry-run | `RESUME_DRY_RUN_PASS` |
| diff | `git diff --check` | PASS |
| secret scan | 변경 diff의 키·토큰·암호 패턴 검사 | 실제 비밀값 없음 |

## 테스트 데이터 정리

- DB 테스트 행: 고유 ID 책방·제출·개선사항 삭제 확인
- Storage 원본: 테스트 파일 삭제 확인
- Storage 미리보기: 테스트 파일 삭제 확인
- 편집 잠금·presence: 테스트 resource key 삭제 확인
- 정리 확인: 복원 기준 DB 8/12/0/2행, 원본 49개, 미리보기 49개 및 전체 해시 일치
- 운영 데이터 변경: 없음

## 경고와 잔여 위험

- 브라우저 자동화로 한글 연속 입력 직후 완료를 검증했다. 실제 사용자 OS의 물리 한글 IME 후보 조합은 owner-private Staging 배포 후 사용자 확인을 한 번 더 권장한다.
- build의 HEIC 지연 로드 청크 크기 경고는 기존 경고이며 이 수정과 무관하다.
- Production 배포는 이번 판정 범위가 아니다.

## 최종 결론

- 판정 근거: 변경 기능 단위 TC, 전체 자동 회귀, 실제 Supabase Staging 왕복, 테스트 정리 후 DB·Storage 해시가 모두 통과했다.
- 배포 가능 여부: owner-private Staging에만 `GO`; Production은 사용자 승인 전 `NO-GO` 유지
- 배포 후 재확인 항목: 한글 IME 마지막 글자 직후 마우스 완료 반복, 재진입 서버 값, 역할 세션·공개 읽기 스모크, Staging 데이터 무결성
