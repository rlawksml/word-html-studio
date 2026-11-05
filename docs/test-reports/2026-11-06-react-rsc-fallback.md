# React/RSC 패치와 호환 fallback 검증

## 범위와 현재 판정

- 운영 반영 전 작업이다. main merge·운영 배포·운영 DB/Storage 변경은 하지 않았다.
- React/RSC 최소 패치 회귀: **GO**. 호환 fallback의 순수 데이터 보존 10TC: **GO**.
- 전체 운영: **NO-GO**. 아래 실제 Staging·백업/복원·불변 fallback 배포물은 아직 완료되지 않았다.
- 성공한 테스트 자료를 보관한다는 사용자 결정을 유지한다. 이번 두 CI는 키·DB·사진 없이 합성 자료만 사용했다.

## #66 React/RSC 19.2.9

기준 `cffc2c7b5598c3a2f13536168b15afa1dff5135c`에서 React·React DOM·react-server-dom-webpack만 19.2.8→19.2.9로 올렸다. 공식 npm metadata의 SRI·peer 범위·동일 dependencies/engines/license를 대조했으며 다른 lock 레코드는 변경하지 않았다. 고정 배포 정책 테스트의 기존 한 TC 안에 3개 버전·SRI·peer 검사를 추가했다. 전체 TC 수·제목은 유지한다.

- 제품 exact: `7e52fc08ce6c91c2bac51c86956b1799ccbfaef9`
- [실제 무료 Linux 격리 CI](https://github.com/rlawksml/word-html-studio/actions/runs/42054777630)
- package SHA256: `ea0501110c32248b1727a02c66996c81a53c167a29e846f12ed8a1cc83a9978c`
- lock SHA256: `fd754aab1d081a548560306c7e89fffae0ca627ed5721a0ae5d8f8480c8fee00`
- source SHA256: `b9efa75abf6bcad584511350cbcc0c2c179424866664db46d054a8efe4e61b3b`

| 검증 | 실제 결과 |
|---|---|
| 무스크립트 의존성 준비 | exit0, 키·DB·audit·설치 스크립트 없음 |
| typecheck / lint / build | 각각 exit0, signal null, limited/error false |
| 기존 전체 단위 회귀 | 277 PASS, FAIL/취소/SKIPPED/todo 0 |
| 소유 프로세스·자원 정리 | 엄격 정리 뒤 2026-11-05T15:26:24.0058727Z COMPLETE |

준비 후 앱 검증은 외부망 차단 환경에서 수행했다. unit stdout64,974B/stderr0이며 기존 64KiB 제한·TC를 약화하지 않았다. 준비/build의 warning 단어 관측 각2·unit4는 미분류 관측값이지 실제 경고 수가 아니다. 독립 소스 리뷰는 공식 npm의 3개 SRI/peer 일치와 전이 변경 없음을 확인했다.

관련 공식 권고: [React RSC typed-array](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3), [RSC streaming DoS](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453). 패치 필요성을 확인했지만 현재 앱에서 악용을 재현한 것은 아니다. 이전 production audit0을 새 pair의 full dev audit 결과로 대체하지 않는다. vinext·Cloudflare 개발 도구 체인의 별도 잔여는 진행 중이다.

## #46/#48 이전 버전 호환 fallback

이전 exact `28efad2e9331b5e2951bf1d9b00cb553530130f7`의 parser가 미래 필드를 제거하던 6TC/4FAIL 기록은 보존한다. 별도 fallback 브랜치에는 기존 validator를 약화하지 않고, 서버가 이미 보유한 JSON의 unknown 필드만 병합하는 현행 helper를 backport했다. 실제 route의 저장식 한 곳에만 연결했고 기존 CAS·권한·사진 sanitizer를 유지했다. side table/Storage/RPC 쓰기는 추가하지 않았다.

- fallback exact: `82f79b6c28ae93c207617a5de0274ba2ebf9e018`
- [실제 고정 10TC CI](https://github.com/rlawksml/word-html-studio/actions/runs/42055883249/job/127344089421)
- `2026-11-05T15:32:08.7829361Z`: `fallback_compatibility tests=10 failures=0 skips=0`
- `2026-11-05T15:32:08.8259560Z`: `SOURCE_POLICY_OWNED_CLEANUP_CONFIRMED`

10TC는 실제 old parser→실제 sanitizer→실제 merge helper로 미래 소식/사진/추가항목/링크 보존, client unknown 거부, 원문 불변, 요청 순서·명시적 제거, 사진 경로, 외부 scheduleRange 제거, 두 합성 payload 왕복, 기존 validator와 route/CAS 연결을 확인한다. route 연결/CAS는 정적 계약이고 HTTP·실DB 요청은 실행하지 않았다. SDK import는 호출 시 실패하는 제한 stub이며 앱/키/DB/네트워크를 사용하지 않는다.

검토한 5개 source만 사용하는 기존 FROM-scratch 프로필을 재사용했다. 독립 source review와 root의 실제 summary/cleanup 확인을 구분했다. 과거 6TC 결과를 이 10TC로 덮어쓰거나 다른 실행과 합산하지 않는다.

**아직 deployable fallback artifact가 아니다.** 이전 dependency baseline·전체 앱·실제 기간/사진/API와 플랫폼 불변 ID·환경 보존 검증이 남는다. 긴급 앱 롤백은 최신 DB/사진/additive schema를 유지하며, 과거 백업 덮어쓰기나 down migration을 포함하지 않는다.

## 고정된 남은 작업 5묶음

1. 잔여 도구 체인 최소 패치·기존 회귀. 새 검증 플랫폼을 만들지 않는다.
2. 승인받은 Staging #86 SQL 1건과 최신 후보 배포.
3. 새 QA 2책방·미사용 월·사진·두 세션으로 실제 사용자 흐름 확인.
4. 최신 독립 백업과 새 빈 대상의 복원. 위치·대상·쓰기 없는 시간은 실제 실행 전 확인한다.
5. 호환 fallback 불변 배포물·환경과 최종 판정 정리. 운영 반영은 별도 사용자 승인 후다.

사용자는 무료 Staging 배포·위 SQL·신규 QA/사진/두 세션 테스트를 허용했다. 기존 업무/QA 자료는 변경하지 않고 성공한 새 QA도 남긴다. 운영 merge/deploy/SQL·유료 전환 권한은 아니다. 중간 작업 하나가 끝났다는 이유로 전체 작업을 종료하지 않는다.
