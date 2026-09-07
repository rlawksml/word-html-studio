# 이슈 #45 Staging 배포 후 테스트 보고서

## 판정

- 결과: `PASS — develop 병합 가능, Production은 미반영`
- 단계: `POST-DEPLOY / owner-private Staging`
- 작성 일시: 2026-09-07 KST
- 검증자: Codex

## 배포 대상

- 브랜치: `codex/v1.1-draft-url-save`
- 배포 커밋: `f638a7dbced1d113fe4e88cb12112846ec5b6523`
- Sites 프로젝트: `책방소식 Staging`
- Sites 버전: `5`
- 환경 변수 revision: `1`
- 주소: `https://bookstore-news-studio-staging.rlawksml.chatgpt.site`
- 공개 범위: owner-private, 소유자 1명, 외부 방문자·그룹 0
- Production 코드·Sites·Supabase 변경: 없음

## TC 결과

| 검증 항목 | 결과 | 증거 |
|---|---|---|
| 배포 provenance | PASS | Sites source·저장 버전·배포 버전이 모두 `f638a7d...` |
| 배포 상태 | PASS | version 5 `succeeded`, 환경 revision 1 |
| 홈·도움말 | PASS | owner-private 인증 경유 GET 200, 올바른 제목·Staging canonical 확인 |
| 공개 Workspace API | PASS | GET 200, 책방 8·소식 묶음 12·개별 소식 46 |
| Worker 상태 | PASS | 최근 10분 오류 레벨 0, 실패 outcome 0 |
| draft 부분 URL 자동 저장 | PASS | 같은 커밋의 production build + Staging DB에서 `https:/` 저장 후 UI `자동 저장됨` |
| 완료 URL 차단·포커스 | PASS | `news.0.applyUrl` 입력에 포커스하고 `소식 1 → 대표 신청 링크` 안내 |
| URL 자동 보완·정상 완료 | PASS | `www.example.com/apply`가 https로 보완되고 정상 URL로 목록 복귀 |
| 브라우저 console | PASS | warn/error 0 |
| 데이터 원상복구 | PASS | DB 8/12/0/2행·Storage 49/49개, 기준 백업 누락 0 |

## Worker 로그 해석

오류 전용 조회에는 `/api/workspace` 한 건이 포함됐지만 이벤트 레벨은 `info`, 오류 값은 `null`, 실행 결과는 브라우저가 요청을 취소한 `canceled`였다. 같은 경로의 직후 요청을 포함해 홈·도움말·Workspace API는 모두 `ok`였고 오류 레벨과 예외·CPU·메모리 실패 outcome은 0건이었다. 따라서 서비스 장애로 분류하지 않는다.

## 테스트 데이터 보호

- 배포 주소에는 읽기 전용 GET만 보냈다.
- 기능 브라우저 검증은 배포 전과 동일한 `f638a7d` production build를 분리된 Supabase Staging에 연결해 수행했다.
- 제목·책방 ID·월·소식 ID로 확인한 `[테스트 #45]` 소식 한 건과 해당 편집 잠금만 삭제했다.
- API 통합 테스트의 고유 2099년 데이터는 `finally`에서 자동 정리했다.
- 최종 백업 dry-run 비교에서 기존 Staging DB와 사진 98개가 모두 기준과 일치했다.
- Production에는 생성·수정·삭제 요청을 보내지 않았다.

## 결론

- GitHub Draft PR #52를 `develop`에 병합할 수 있다.
- 이슈 #45는 Production에 아직 반영되지 않았으므로 닫지 않는다.
- Production 배포는 나머지 v1.1 이슈와 함께 별도 승인·전체 회귀·백업 확인 뒤 진행한다.
