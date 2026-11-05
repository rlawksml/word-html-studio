# #94 모든 사진 보관·미참조는 경고 — RED/GREEN 검증

## 판정

**파일 fixture·순수 복원 정책·격리 앱 회귀 범위 GO / 운영 NO-GO.** 사용자가 승인한 정책을 구현했으며 실제 Supabase 백업/복원·Storage·배포를 실행한 결과는 아니다.

- 브랜치: `codex/m1-retained-photo-warnings`, 기준50d0356
- 최종 검증 코드: `1f9c6051f342f9ab0c1c7b38cc9435fa3286db87`
- main merge·운영/Staging 배포·공유 SQL·기존 DB/사진/QA·과금 변경0.

## 배경·최소 수정

#88은 응답 유실 때 사진을 삭제하지 않고 보존한다. 기존 백업 verifier는 미참조 사진이 하나라도 있으면 실패시켜 이 보존 정책과 충돌했다. 사용자는 모든 사진을 백업에 포함하되 미참조는 경고만 남기도록 선택했다.

- `backup-manifest-policy.mjs`: 참조 재계산·필수 inventory/schema·누락/변조 검증을 유지하고 내부 결과를 failures/warnings로 나눴다. 모든 내용 검증이 성공할 때만 고정 `BACKUP_UNREFERENCED_ORIGINALS_RETAINED`/`BACKUP_UNREFERENCED_PREVIEWS_RETAINED`를 준다.
- `backup-utils.mjs`: 기존 `PASS|FAIL` 계약에 warnings 배열을 추가했다. 파일·hash·INCOMPLETE·내용 검사 실패에는 경고가 빈 배열이다. manifest·DB JSON·사진을 고치거나 삭제하지 않는다.
- verify CLI와 restore dry-run/최종 요약에 warnings만 추가했다. 출력에 새 사용자 경로·사진 이름·원문은 넣지 않는다.
- exporter·schema/marker 정책·객체 선택/업로드/후검증은 바꾸지 않았다. 복원은 여전히 manifest의 모든 객체를 포함하며 참조된 사진만으로 필터링하지 않는다.
- baseline은 같은27파일에서 새 top-level TC1개를 반영해276→277과 대응 pin만 바꿨다. 다른9개 helper·두 manifest·SDK/SQL은 그대로다.

## 실제 실행

| 단계 | exact SHA / run / job | 실제 결과 |
|---|---|---|
| 첫 정책 RED | 28fb734 /[42024820289](https://github.com/rlawksml/word-html-studio/actions/runs/42024820289)/127236337309 | 30등록/27PASS/3FAIL, ID20·21·30, preflight/정리 확인 |
| 보존 assertion 강화 RED | 5f37424 /[42025220528](https://github.com/rlawksml/word-html-studio/actions/runs/42025220528)/127237666350 | 같은30개,27PASS/3FAIL20·21·30, exit1, 취소/skip/todo0, 정리12:13:07.9507127Z |
| 최종 같은30TC GREEN | 1f9c605 /[42025714995](https://github.com/rlawksml/word-html-studio/actions/runs/42025714995)/127239335924 | **30PASS**/나머지0, 정리12:16:40.2730872Z |
| 기존 복원 정책 | 1f9c605 /[42025715634](https://github.com/rlawksml/word-html-studio/actions/runs/42025715634)/127239336378 | **25PASS**/나머지0, 정리12:16:38.6498113Z |
| 전체 앱 | 1f9c605 /[42025714813](https://github.com/rlawksml/word-html-studio/actions/runs/42025714813)/127239344011 | type/lint/build exit0, **277PASS**/fail·cancelled·skipped·todo0, 엄격 정리 후 COMPLETE |

첫 RED 이력을 보존하고 독립 리뷰에서 모든 참조 소멸 사례와 실패 전후 사진 존재/bytes를 강화한 뒤 최종 RED를 다시 실행했다. **최종 RED와 GREEN의 테스트 SHA는 동일**하다. TC20·30은 고정 case ID로 결과를 모아 첫 정책 assertion 실패가 나머지 matrix 확인을 감추지 않게 했다. 서로 겹치는30·25·277과 이전29/276·audit27은 합산하지 않는다.

## TC·보존 증거

| TC | 요구와 실제 범위 | 결과 |
|---|---|---|
| BACKUP-COMPLETE20 | 원본만/미리보기만/양쪽/소식·사진 참조0의 네 경우: PASS+해당 경고, DB/manifest·양쪽 사진 bytes 불변, 모든 inventory 객체의 복원 계획 포함 | PASS |
| 21 | 정상0행·0사진은 PASS·warnings[] | PASS |
| 30 부정 matrix | 거짓 미참조 신고·미참조 파일 누락·변조·참조 누락과 미참조 동시 발생: FAIL·warnings[], 검증/예외 후 DB/manifest 및 사진 존재/bytes 불변 | PASS |
| 30 CLI 계약 | verify와 restore 요약2곳에 고정 경고 전달, verify 실패 exit1 — **소스 텍스트 검사만** | PASS |
| 기존01~19·22~29 (27개) | 필수 목록·schema·집계·중복·참조·hash·INCOMPLETE·미래 row 보존 등의 기존 기대 유지 | PASS |

fixture가 만든 새 tmpfs mkdtemp의 합성 사진만 사용했다. 파일 누락/변조 주입과 정리도 이 소유 fixture 안에서만 했고 공유 DB·기존 백업/QA·사용자 사진에는 접근하지 않았다. 검사 함수의 쓰기·삭제는 없으며 restore가 실제로 쓰는 `verification.manifest`도 정적 추적했다. 다만 TC20 planner 입력은 fixture.manifest이므로 **반환 manifest→실제 SDK 복원까지 실행한 통합 증거는 아니다.**

## 지문·실행 경계

- 테스트: `064f8e3703c5648535e6903cc6dc669c04922b86bdcde1979e28dd45382e4ac6` (419줄)
- fixture: `5686f7dccaac52321a4101dd25cebc61a8e70b85f1c9b5ca6bc86dc9d53447ff` (불변)
- package: `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8` / lock: `bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe` (불변)
- source SHA-256: `9b58868fa8345519daf0482057f9308b46c42f99c5427800625de68f8fc5667f`
- baseline: `b2521a081fd68b41dca3a7523b04c5ad34efb48764f2888f3d983b176a7daaeb`

native는 무료 공개 Linux의 무키·무SDK·network-none/비root/RO source·낮은 자원 한계 fixture에서 실행했다. CLI2파일은 텍스트로만 복사했으며 import하지 않았다. 전체 앱은 승인된 무스크립트·무키 prep→망 분리/RO 인계→prep 부재→오프라인 실행 경계다. 앱/대상 테스트를 로컬 Mac 호스트에서 실행하지 않았다. 일반 verify/실Supabase job의 SKIPPED를 TC PASS로 세지 않았다.

주 담당·별도 QA·Astra가 실제 metadata·고정 로그·source/hash·검사/정리 조건을 대조했다. full277의 실제 카운터12:17:12.3962612Z 이후12:17:12.8383539Z COMPLETE를 확인했다. 자식 종료·OOM·최종 OS/컨테이너 및 정확한 소유 자원 정리 조건을 완화하지 않았다. 최종 실행들은 artifact0이다.

## 남은 게이트

- unit stdout64972bytes/stderr0로 공유64KiB까지564bytes 여유다. 이번은 제한 없이 PASS했지만 TC 추가 전에 별도 compact reporter/분할 검증 설계가 필요하다. 상한 상향·TC 제거·제목 축약은 하지 않았다.
- npm/build의 관측 warning 단어 matching 각2는 미분류다. unit의 관측4는 TC20·30 제목의 `warnings`가 TAP에 반복되는 것과 부합하지만 원시 로그를 독립 분류한 증거는 아니다. 실제 runtime 경고4건이라고 표현하지 않는다.
- [별도 실제 audit](https://github.com/rlawksml/word-html-studio/blob/3e8289ffd041c3fba48ec3087c226d286c10f5e7/docs/test-reports/2026-11-05-issue87-metadata-audit.md)의 source-map-js high1·#66·#93 경로/TOCTOU·live snapshot·실제 백업/빈 대상 복원·브라우저/DB/사진/동시 편집·exact fallback4FAIL은 해결하지 않았다.
- 검증한 것은 백업에 **목록화된 모든 객체**와 참조 무결성이다. 특정 시점 원자 snapshot 또는 원격의 숨은/미신고 inventory까지 완전하다는 증거가 아니다.

따라서 #94를 운영 반영 완료로 닫지 않는다. 최신 DB/사진을 유지하는 긴급 앱 롤백과 독립 복원 증거, 별도 사용자 운영 승인이 필요하다.
