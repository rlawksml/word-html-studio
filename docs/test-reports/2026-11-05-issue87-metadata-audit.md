# #87 metadata-only audit — 재개·RED/GREEN·실제 검사

## 판정

**검사 도구27TC PASS / 실제 production audit FAIL(FINDINGS) / 운영 NO-GO.** 도구가 검사에 성공한 것과 의존성이 안전한 것은 다르다. main merge·운영/Staging 배포·공유 SQL·기존 DB/사진/QA·과금 변경0이다.

- 브랜치: `codex/m1-dependency-audit`
- 최종 검증 코드: `c69a010007b63a381493294117dd3e261c6ecac1`
- package SHA-256: `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8`
- lock SHA-256: `bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe`
- 기존 앱/276목록·공통 helper·두 manifest는 basebae02fb와 동일하다. 앱 전체276/type/lint/build의 이전 증거는 [별도 후보 보고서](https://github.com/rlawksml/word-html-studio/blob/00e3445b0190aaf7874fda36fe87677c814066b6/docs/test-reports/2026-11-05-issue87-next-candidate.md)이며 이번 native27에 합산하지 않는다.

## 실제 결과와 TC

| 실행 | exact SHA / run / job | 실제 결과 |
|---|---|---|
| 모순 응답 RED | d3a15aa /[42022598104](https://github.com/rlawksml/word-html-studio/actions/runs/42022598104)/127228852583 | 19중18PASS/1FAIL, ID19, exit1·preflight·소유 정리 확인 |
| 같은19TC GREEN | 9c4d82a /[42022739758](https://github.com/rlawksml/word-html-studio/actions/runs/42022739758)/127229318555 | 19PASS/실패·취소·skip·todo0, 정리11:54:58.4383949Z |
| 정책19+실제 runtime8 | c69a010 /[42023829900](https://github.com/rlawksml/word-html-studio/actions/runs/42023829900)/127233017496 | **27PASS**/나머지0, 정리12:03:10.4602509Z |
| 실제 metadata-only audit | c69a010 /[42024099655](https://github.com/rlawksml/word-html-studio/actions/runs/42024099655)/127233942962 | **FINDINGS**, npm11.19.1, high1/critical0/total1 |

19TC의 RED/GREEN 테스트 blob은 동일하다. RED에서는 ID19의 첫 모순 응답 assertion에서 실패했고, 뒤 변형까지 실행했다고 세지 않는다. 같은19TC GREEN에서 직접 advisory severity·연결된 record severity·빠진 via record 변형을 확인했다. 모순된 집계는 SCHEMA/BLOCKED로 처리하며 high 권고를 low 집계가 가릴 수 없다.

TC 매핑:

- AUDIT01~06: lock identity와 zero/low/moderate/high·exit 기준 분류 — PASS.
- AUDIT07~18: 오류/타임아웃·출력 제한의 합성 분류, JSON/endpoint/schema/counter/ID·완료 선언 검증 — PASS. 합성 결과 객체 검증은 실제 프로세스 고장 주입이 아니다.
- AUDIT19: 직접·연결 severity 모순/빠진 via record — RED 후 PASS.
- AUDIT-RUNTIME01~04: 실제 descriptor 읽기, symlink/hardlink/directory/empty/초과 파일 거부·기존 fixture bytes 보존 — PASS.
- AUDIT-RUNTIME05~08: 실제 고정 Node 빈 환경, stdout40000+stderr40000의 공유64KiB 초과 SIGKILL, 1초 wall TIMEOUT/SIGKILL, pre-abort sentinel 미생성 — PASS.
- AUDIT-LIVE01: 같은 package/lock의 알려진 high 권고0 요구 — **FAIL**, source-map-js 권고1건.

27과 앞선19·과거24/29/25/247/276은 중복·다른 범위여서 합산하지 않는다. 주 담당과 독립 Astra 검토자가 실제 metadata·고정 로그·동일 source/hash·종료 조건을 대조했다. 각 수동 실행의 일반 verify·Supabase integration 등 SKIPPED job은 성공 TC로 세지 않는다.

## 실제 audit 발견 사항

고정 요약은 `FINDINGS/HIGH_OR_CRITICAL`, npm11.19.1, info0/low0/moderate0/high1/critical0/total1, `GHSA-68fv-2mgg-jv7q`, source ID1241209다. [공식 권고](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)는 source-map-js1.0.0 이상1.2.2 미만의 source-map offset 처리에 의한 가용성 문제와1.2.2 수정 버전을 명시한다. 현재 lock은1.2.1이며 postcss8.5.23의 production 경로가 이를 `^1.2.1`로 사용한다. 실제 서비스에서 공격 입력이 이 parser에 도달하는지·운영 장애/자료 손상이 있었는지는 이번 검사로 확인한 것이 아니다.

자동 fix/install·수동 SRI 조작·audit gate 완화는 하지 않았다. source-map-js 업데이트는 별도 최소 lock 변경·graph 검토·재audit·전체 회귀가 필요하다. 새 두JSON 전달은 추가 허용 여부를 사용자에게 요청했으며, 응답 전에는 재전달·업로드하지 않는다. 개발 Miniflare의 sharp0.35.2와 #66 React/vinext는 이번 `omit=dev` 결과로 해결 처리하지 않는다.

## 안전 경계와 정리

공개 표준 무료 Linux에서 검토한 native closure13개를 hash 고정했다. npm은 이미 설치된 runner 도구만 FROM scratch 이미지로 복사했다. 컨테이너에는 고정 public JSON2개만 넣고 앱 소스·npmrc·서버/GitHub 키·DB·사진을 넣지 않았다. registry는 공개 lock graph 전체와 Node/npm/platform metadata를 받을 수 있다. `omit=dev`가 전송 범위 전체를 보장하는 것은 아니다. [npm 공식 문서](https://docs.npmjs.com/cli/v11/commands/npm-audit/)의 plain audit/exit 기준·전송 설명을 따르며 fix·서명검사·설치는 실행하지 않는다.

실제 Node/npm·input/toolchain은 RO다. 사용하지 않는 RW/toolchain volume을 제거하고 audit 전용 create/inspect/preflight를 분리했다. 비루트·cap-drop/NNP/seccomp·메모리3GiB/CPU2/PID128·scratch512MiB·파일256MiB·CPU180초·npm wall90초·stdout+stderr 공유64KiB·controller8분/정리 예약2분을 유지했다. bridge는 registry-only 방화벽이 아니다. 빈 환경/서로 다른 빈 npm config를 사용하고 cache·로그는 이번 scratch만 쓴다.

12:05:13.5410623Z SEAL→12:05:13.6403481Z FINAL→12:05:13.9211203Z COMPLETE 순서를 확인했다. final `sealed-status`는 입력 descriptor/hash 불변·자식0·OS loopback-only·OOM0을 재검사하고 호스트의 Networks[]도 확인한다. 검토한 controller는 정확한 소유 컨테이너 정리 뒤만 COMPLETE를 출력한다. 따라서 이 run의 exit1은 제어 실패/BLOCKED가 아닌 **발견된 high 권고에 대한 실패**다. 정리 미확인 marker는 없고 두 최종 run 모두 artifact0이다. 기존 volume·다른 PID·사진·백업은 정리하지 않았다.

## 남은 범위

full90초 지속·OOM·임의 descendants·descriptor identity race·network seal/정리 fault injection은 실행하지 않았다. 작은 runtime TC와 실제 성공한 제어 경로를 모든 적대 조건의 증거로 확대하지 않는다. 이번 audit는 알려진 의존성 graph 검사이며 배포 bundle·실행 경로 전체 보안 감사가 아니다.

source-map-js 수정·#66·실브라우저/Network/메모리·실DB/Storage·#93/#94·최신 독립 백업/빈 대상 실제 복원·옛 exact fallback4FAIL 해결 및 환경 보존이 남는다. 실제 운영 반영은 별도 사용자 승인 전까지 금지다.
