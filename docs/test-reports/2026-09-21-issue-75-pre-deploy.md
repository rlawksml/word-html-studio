# Issue #75 로딩 피드백 사전 배포 검증 보고서

## 판정

- 코드·PR 준비: **GO**
- Staging/Production 배포: **NO-GO (Staging 브라우저 행동 검증 전)**
- 기존 Supabase 데이터: **변경 없음**

이번 변경은 `develop` 기준 `codex/issue-75-loading-feedback` 브랜치에서만 검증했다. Production·Staging Database/Storage 생성·수정·삭제 테스트는 실행하지 않았다.

## 변경 범위

- 로그인 암호 확인 → Workspace 준비 단계 로딩 안내
- Enter+클릭·연속 클릭의 동기 중복 실행 차단
- 인증 후 Workspace 실패 시 탭 세션 rollback과 자신이 만든 쿠키만 조건부 정리
- 수동 저장·입력 완료·이탈 저장·변경 버리기·ZIP 생성의 버튼 단위 pending 상태
- 입력 완료 저장 중 편집·이탈 차단
- 역할 화면 lazy loading의 브랜드형 상태 표시
- 모바일 키보드 높이를 고려한 모달 내부 스크롤
- 로그인·이탈 실패 후 재시도 조작으로 키보드 포커스 복귀

## 자동 검증 결과

| 검증 | 결과 | 증거 |
|---|---|---|
| `npm run lint` | PASS | ESLint 오류 0건 |
| `npm run build` | PASS | Vinext 5개 환경 빌드 완료 |
| `npm test` | PASS | 79 PASS / 0 FAIL |
| 신규 로딩 회귀 | PASS | `async-loading-feedback.test.mjs` 4 PASS |
| 비동기 잠금 행동 | PASS | 동일 작업 연속 실행은 1회만 수행하고 성공·실패 뒤 다시 실행 가능 |
| 로그아웃·rollback 쿠키 경계 | PASS | 일반 로그아웃은 쿠키 삭제, 다른 세션 ID rollback은 쿠키 보존 |
| `git diff --check` | PASS | 공백·패치 오류 없음 |
| 비밀값 검사 | PASS | 코드·문서·테스트에 실제 작업 암호·Supabase 키 추가 없음 |

`npx tsc --noEmit --incremental false`는 저장소 기존 baseline 오류로 전체 FAIL이다. 이번 변경에서 추가됐던 `workspaceSessionHeaders()` 반환 타입 오류는 `Record<string, string>` 명시로 해소했다. 남은 오류는 기존 이미지 Route 3건, Cloudflare 전역 타입 3건, Vite 설정 1건이다.

## TC 판정

### TC-AUTH-005 · 로그인 로딩과 중복 제출 차단

- 정적·Route 동작 검증: PASS
- 실제 지연 응답에서 단계 전환·연타 요청 수 확인: BLOCKED
- 근거: 로컬 `.env.local`의 Supabase에는 v1.1 `news_schedule_ranges` migration이 없어 초기 Workspace가 `PGRST205`로 준비되지 않았다. 기존 데이터를 변경하거나 운영 migration을 적용해 우회하지 않았다.

### TC-SUB-012 · 수동 저장·입력 완료·이탈 중복 실행 차단

- 코드·회귀 검증: PASS
- 실제 Staging 저장 실패/재시도: BLOCKED
- 입력 완료 중 editor body를 inert 처리하고 controller ref에서도 변경·이탈을 방어한다.

### TC-HTML-005 · ZIP 준비 로딩과 중복 다운로드 차단

- 코드·회귀 검증: PASS
- 실제 여러 원본 사진 ZIP의 모바일·네트워크 실패 조작: BLOCKED
- 두 ZIP 버튼 공통 잠금, 성공·실패 후 `finally` 재활성화를 확인했다.

## 관찰 사항

- 빌드의 500kB 초과 chunk 경고는 기존 경고이며 이번 변경의 실패 조건은 아니다.
- 로그인·이탈 pending 시작 시 상태 영역으로 포커스를 옮기며, 실패 시 암호 입력 또는 계속 작성 버튼으로 복귀시킨다. 완전한 modal focus trap과 최초 트리거 복귀는 별도 접근성 개선 후보다.
- 최신 내용 다시 불러오기와 게시 완료의 즉시 서버 저장 상태는 이번 범위에서 제외했으며 별도 이슈가 적절하다.

## 배포 전 남은 필수 검증

1. v1.1 migration이 적용된 격리 Staging에서 로그인 API와 Workspace 응답을 지연시켜 단계 문구·POST 1회·실패 rollback을 확인한다.
2. 테스트 전용 Submission으로 임시 저장·입력 완료·이탈 버튼 연타와 실패 후 재시도를 확인하고 정확한 테스트 ID만 정리한다.
3. 원본 사진이 여러 장인 테스트 전용 완료본으로 두 ZIP 버튼의 잠금·성공·실패 복구를 확인한다.
4. 360px 모바일 viewport와 소프트 키보드 조건에서 접속 모달 하단 버튼과 진행 안내가 스크롤 가능한지 확인한다.

위 네 항목이 PASS가 되기 전에는 Staging 결과를 Production에 병합하지 않는다.
