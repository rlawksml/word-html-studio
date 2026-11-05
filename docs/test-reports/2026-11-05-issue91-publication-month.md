# #91 빈 발행 월 — 최소 방어와 개별 검증

## 판정·대상

- PRE-DEPLOY, 2026-11-05: **순수·구조15TC GO / 운영 NO-GO**
- 기준16b7558, 브랜치 `codex/m1-publication-month-validation`
- 검증 코드: `77c65da3185886057624373fc1d9d9d6a42a2a2e`
- 앱·staging 배포, main merge, SQL/DB/사진/환경/요금제 변경 없음

## 원인과 범위

HTML 모드의 month input은 빈 문자열도 raw setter로 보냈다. controller의 달력 계산은 역할 분기 전 항상 실행되므로 `month="" → numericMonth=undefined → first=NaN → Array(NaN)` 경로가 있었다. 과거 기준cdf4be1에도 같은 구조다. 실제 UI 재현은 아직 없고, 본 검증의 PMONTH-15는 기존 계산을 그대로 옮긴 순수 모델에서 RangeError를 확인한 것이다.

최소 변경:

- `workspace-formatters.ts`: 기존 `isDigestOrderMonth` 형식 검사를 재사용. invalid 후보는 trim/현재 월 보정 없이 previous 그대로 유지. 달력은 invalid에 `[]`, valid에는 기존 날짜 계산을 유지.
- controller: raw setter를 비공개 `setMonthState`로 바꾸고 함수형 previous를 사용하는 guarded setter만 공개. calendar memo는 순수 helper에 위임.
- `useState(initialMonth)`와 의도된 방문자 복귀/로그아웃 초기 월 reset은 유지. API/UI/세션/사진/HTML 생성·`shiftMonth`는 바꾸지 않음.
- 기존 `0000~0099`의 JS Date 해석도 유지했다. 형식 검사를 완전한 HTML 월/고대력 지원으로 설명하지 않는다. invalid 초기값의 `[]`는 달력 안전성만이며 앱 전체 초기 복구 보장은 아니다.

## 실행 결과

[run41974214773](https://github.com/rlawksml/word-html-studio/actions/runs/41974214773), exact `77c65da3185886057624373fc1d9d9d6a42a2a2e`, 2026-11-05 05:28:48Z 완료, success.

실제 로그: `Source policy validation PASS: suite=publication tests=15 failures=0 skips=0 commit=77c65da3185886057624373fc1d9d9d6a42a2a2e`.

**15PASS / fail0 / cancelled0 / skipped0 / todo0**. 독립 검토자가 소스·테스트·CI 경계와 원격 metadata/실제 로그를 대조했다. guard/source 성공, verify·Supabase·rollback은 skip했다.

| TC | 확인 내용 | 결과 |
|---|---|---|
| PMONTH-01~02 | valid→invalid→valid·연속 함수형 갱신 모델에서 마지막 수락 월 유지 | PASS2 |
| PMONTH-03~05 | 빈값·부분 연도·공백·개행·비문자열·비정규 월 거부, 자동 보정 없음 | PASS3 |
| PMONTH-06~09 | 윤년/평년·12개월 일수·요일별 선행 null·연말 경계 | PASS4 |
| PMONTH-10~12 | 기존 저연도 계산 동등·배열 상한/유일성·결과 간 독립성 | PASS3 |
| PMONTH-13 | 순수 함수 호출 전후 합성 원문/사진 참조 모델 불변 | PASS1, React/DB 증거 아님 |
| PMONTH-14 | raw setter 비공개·함수형 guard·memo 연결 소스 계약 | PASS1, mounted UI 아님 |
| PMONTH-15 | 이전 빈값 계산의 RangeError 모델과 새 helper의 빈 배열 | PASS1, 실제 UI 재현 아님 |

정확한 실행은 검토된 publication profile의5개 허용 파일과 Node TS strip·내장 기능만 사용했다. SDK/환경파일/키/실제 네트워크는 없다. memory256MiB/swap0/CPU1/PID32/scratch16MiB·CPU30초/wall45초/출력64KiB·RO root·비root/빈 환경·OS preflight 조건을 통과한 뒤 단일 `tests/publication-month.test.mjs`를 실행했다. 호스트 대상 실행과 새 의존성 설치는 이 검증에 없다.

## 미검증·후속

| 채널 | 상태 | 남은 확인 |
|---|---|---|
| Console/pageerror/rejection | BLOCKED | 실제 React mount·native month clear/부분 연도 편집 |
| Network/API | BLOCKED | invalid 입력 시 신규 월 요청/lease/순서쓰기0, 정상 heartbeat와 구분 |
| 세션 복귀/역할 이동 | BLOCKED | 방문자/입력/HTML 전환·의도된 initial month reset |
| heap/DOM/listener/timer | BLOCKED | 반복 입력·정리/GC 이후 추세·retaining path |
| 서버/실DB | SKIPPED | 외부 환경에 접속하지 않음 |
| 전체 type/lint/build | BLOCKED | 별도 승인된 오프라인 앱 검증 경로 준비 중 |

controlled input이 부분 입력을 과도하게 되돌리지 않는지, 개별/통합 HTML·이전/다음 달 사용성이 유지되는지는 반드시 브라우저에서 확인해야 한다. 새 DB 행·Storage 객체·presence를 만들거나 지우지 않았다. 기존 보관 QA와 운영 자료도 변경하지 않았다.

파일 크기: formatter87·TC182줄. controller는 기존872→873줄로 최소 검증 경계만 수정했다. 전체 controller 분리는 다른 저장·인증 흐름에 영향을 주는 별도 리팩터링이므로 이번 수정에 섞지 않았다.

보고서-only 후속 커밋은 실제 검증 코드 SHA와 구분한다. #91은 UI·전체 회귀 전까지 닫지 않는다.
