# 사용자 요청 일시 중단 — 다음 시작점

사용자가 2026-11-05 작업을 잠시 멈추고 이어하기 기록을 요청했다. 실행 중인 구현 에이전트를 중단했고 새 테스트·audit·배포를 시작하지 않았다. **재개 요청 전까지 작업을 멈춘다.**

## 완료된 검증

- #92 백업 완전성: RED19/29 재현→같은29/복원25/전체276 및 type/lint/build·엄격 정리 PASS. 실제 백업·복원은 아니다.
- #87 최소 Next/eslint-config-next16.4.5 후보: exactbae02fb, [run42002180281](https://github.com/rlawksml/word-html-studio/actions/runs/42002180281), 새 lock 무스크립트 설치/type/lint/build·276PASS와 정리 확인. [상세](2026-11-05-issue87-next-candidate.md).
- 별도 metadata 도구 정책24와 실제 두JSON 생성·제한 전달은 완료. 추가 업로드 없음. audit는 실행하지 않았다.
- #46/#48 옛 exact fallback parser는6TC 중4FAIL로 보존 요구를 만족하지 않았다. 후보 성공으로 대체하지 않는다. [현재 롤백 지침](../ROLLBACK_PREPARATION.md).

서로 중복되는29/25/276/24와 과거247/99는 합산하지 않는다. 보안/브라우저/실DB·백업·롤백 전체 운영 판정은 계속 **NO-GO**다.

## 사용자 확정 정책 — #94, 아직 구현 안 함

**모든 사진 보관·백업, 미참조 사진은 경고만.** 참조 사진의 누락·파일/해시 오류·참조 재계산 불일치는 계속 실패다. 미참조 파일을 제외하거나 삭제해 성공시키지 않는다. 실제 백업 경로·독립 복원·사진 삭제/GC·공유 SQL·배포·유료 설정 승인이 아니다.

## 멈춘 위치와 재개 순서

1. `codex/m1-dependency-audit` basebae02fb에 새 audit 정책/읽기/launcher/controller·18TC 선언·workflow와 기존 routing3파일 수정이 **미커밋 WIP**로 있다. 파일9개와 tracked patch를 새 비공개 로컬 체크포인트에 보존하고 바이트 비교했다. 기존 원본·095 checkpoint를 덮어쓰지 않았다. DB 또는 독립 장치 백업은 아니다.
2. 다음에는 전체 closure·policy/CI를 주 담당과 독립 안전 검토자가 리뷰한다. 아직 해시 placeholder가 있고 TC·실제 audit 미실행이므로 PASS로 기록하거나 바로 실행하지 않는다.
3. 리뷰 후 무료 공개 Linux의 무키·앱소스 없는 정책 TC와 no-artifact audit를 검증한다. findings/FAIL과 인프라·schema/BLOCKED를 구분하고 raw JSON/로그는 공개하지 않는다.
4. #94 승인 정책을 별도 브랜치의 RED/최소 수정/회귀·이슈 보고 순서로 적용한다. 현재 verifier의 미참조 차단 동작은 아직 그대로다.
5. #93 경로·browser runtime·실제 UI/DB/사진/동시 편집·#86 SQL·최신 독립 백업/빈 대상 복원·호환 fallback/환경 증거를 차례로 확보한다. 새 QA/SQL/배포/복원 대상은 별도 승인이 필요하다.

원래 dirty 작업36개·기존 DB/사진/성공 QA를 보존했다. main merge·운영/Staging 배포·SQL·유료 변경은 하지 않았다. 사용자의 재개 요청은 다음 준비 작업을 이어가는 것이며 운영 반영 자동 승인이 아니다.
