# #88 사진 보존 방어 1차 구현 — 실행 검증 전 기록

## 범위와 판정

- 기준: 부모가 제공한 `0951802`, 별도 `codex/m1-photo-retention-safety` 작업 공간. 이 문서는 커밋·배포 식별 증거가 아니다.
- 코드 수정과 TC 작성까지만 수행했다. 대상 코드·Node syntax·npm·Git·브라우저·API·DB·Storage·세션·환경 파일은 실행/접근하지 않았다.
- Console / Network / server / heap 측정: **SKIPPED**. 운영·Staging 자료 변경 및 사진 삭제: **없음**.
- 작성된 TC-IMG-008~019: 12건 모두 **BLOCKED**(부모의 격리 실행 검증 대기). PASS 0 / FAIL 0 / BLOCKED 12. 추가 P0 통합/사용성 회귀도 미검증이다.
- 현 판정: **NO-GO — 테스트·리뷰·정확한 fallback 호환·백업 확인·사용자 운영 승인이 남아 있음**.

## 배경: 확인된 소스 경로와 미확인 사고를 구분

이전 controller는 업로드된 파일의 DB 연결 저장이 throw하면 예약된 경로를 모두 삭제했다. 서버가 저장을 완료한 뒤 응답만 유실되어도 같은 catch로 갈 수 있다. 또한 이전 자동 저장의 응답 시점에 최신 로컬 제거 queue를 처리하면 서버가 아직 참조하는 파일을 삭제할 수 있는 소스 경로가 있었다. 실제 서비스에서 이 경로로 자료가 손상됐다고 재현하거나 확정한 것은 아니다.

단순 전역 참조 GET 후 DELETE는 동시 저장과의 TOCTOU를 제거하지 못한다. 이번 단계는 참조 안전 GC를 서둘러 추가하지 않고 물리 삭제를 보류하는 작은 방어다.

## 코드 경계와 계약

| 파일 | 변경 |
|---|---|
| `lib/image-retention-policy.mjs` + `.d.mts` | 네트워크/DB/Storage 의존성 없는 보존 결과·legacy 요청 검증, 큐 시점 업로드 연결 대상 검사 |
| `lib/workspace-client.ts` | `deleteStoredImages(images)` async 시그니처 유지, fetch·DELETE 없이 명시적 보존 결과 반환 |
| `app/api/images/route.ts` | 입력자 세션·배열 1~500개·경로 검증 후 200 보존 응답; DELETE의 admin client/DB/Storage 호출 제거 |
| `hooks/use-studio-controller.ts` | pending 물리 삭제 queue와 callback/catch 정리 제거; queued transform 안에서 책방·월·소식 확인 |
| `components/molecules/NewsEditorCard.tsx` | × 버튼을 ‘소식에서 제거’로 설명, 파일 보관 안내; 참조 제거 동작은 유지 |
| `tests/image-retention-policy.test.mjs` | 실제 client helper·주입형 legacy handler·순수 연결 함수·fake ledger·소스 연결 경계 TC 12건 |
| 기존 rendered/legacy integration 테스트 | 삭제를 요구하던 기대값만 보존 계약으로 조정; 실제 실행/정리 권한을 추가하지 않음 |

유효한 legacy DELETE 결과:

```json
{"retained":true,"deleted":false,"code":"IMAGE_CLEANUP_DEFERRED"}
```

`retained`는 이 작업이 물리 삭제하지 않았다는 뜻이다. 파일 존재·완전한 업로드·DB 연결 성공·참조 안전 검증을 보증하지 않으며, 삭제 작업이 예약됐다는 뜻도 아니다. 권한·입력 오류는 기존처럼 거절한다. POST 서명 예약·직접 PUT 전송·GET 비공개 원본 다운로드 구현은 변경하지 않았다.

## 실패·동시성·수명

- DB attach 시도 뒤 오류나 후처리 오류에서도 파일은 남긴다. DB 반영 여부를 추측해 정리하지 않는다.
- 연결 전 원본만 올라간 실패·재예약 파일도 이 단계에서는 보수적으로 남긴다. 업로드 파일명/경로를 별도 전역 cleanup queue에 축적하지 않는다.
- `handleSubmissionSaved`는 탭 복구본 갱신만 담당한다. 그 콜백의 adopted 데이터가 DB 참조 상태라고 해석하지 않는다.
- 사진 참조를 소식 JSON에서 제거하는 기존 저장 흐름은 유지한다. 새 target 검증은 큐의 transform 안에서 수행해 대상 소식이 사라졌는데 성공으로 알리는 경우를 막는다.
- 저장 오류 메시지는 그대로 보존하며 ‘파일 보관’ 안내와 구분한다. 물리 삭제 성공으로 표시하지 않는다.

## 자원·공개 범위·롤백 tradeoff

- 제거·실패 파일 때문에 Storage 사용량은 늘 수 있다. 코드 상 한 원본은 최대 20MB, 미리보기 최대 3MB이며 실제 총량·잔여 quota는 조회하지 않았다. 비용/유료 플랜 변경은 없다.
- 사진 참조 제거는 기존 공개 미리보기 URL 철회가 아니다. 알려진 URL 접근이 남을 수 있어 개인정보 삭제로 설명하면 안 된다.
- 새 client의 무전송은 오래된 서버로 요청이 가는 경우도 보호한다. 새 server의 backstop은 오래된 client를 보호한다.
- **오래된 client와 server를 모두 되돌리면 기존 위험도 돌아올 수 있다.** 정확한 fallback 배포물을 별도 격리 검증하기 전 운영 판정은 NO-GO다.
- 독립된 참조 안전 GC·백업·보관 기간·관리자 승인·quota 관찰은 후속 설계다. 새 SQL·새 flag·기간 정리·파괴적 복구는 추가하지 않았다.

## 검증 인계

1. 부모가 외부 네트워크 차단, 빈 allowlist 환경, 소스/toolchain read-only, 전용 scratch 쓰기, CPU·메모리·프로세스·파일·시간 한도를 갖춘 격리 실행 환경에서 `npm run test:image-retention`을 실행한다.
2. 타입 검사·lint·관련 기존 테스트·build·diff 검사는 부모가 별도로 수행한다. 이 기록은 성공을 주장하지 않는다.
3. fake ledger와 source assertions는 실제 React effect·API·DB integration 증거가 아니다. save commit 뒤 응답 유실, 늦은 autosave, target 제거, 부분 업로드, Console/Network/server/heap 반복 검증이 남아 있다.
4. legacy `supabase-integration.test.mjs`는 exact-fixture 직접 cleanup을 포함하므로 실행하지 않았다. 이 작업 공간 기준 소스는 env flag로 활성화 가능한 구형 어댑터이며, 부모의 별도 하드 비활성/격리 안전 변경을 우선 보존해야 한다. 테스트의 보존 응답 기대값 변경은 새 실DB cleanup 승인이나 성공 QA 삭제 승인이 아니다.
5. 사진 POST/GET·역할 권한·HTML ZIP 다운로드 회귀와 정확한 fallback/미래 데이터 보존 검증 뒤에만 다음 게이트로 진행한다.

## 파일 크기 예외

새 정책·선언·테스트는 500줄 미만이다. 기존 `use-studio-controller.ts`는 903줄에서 872줄로 줄였으나 전체 분리는 다른 저장·세션·HTML 흐름과 섞이는 별도 리팩터링이므로 이번 보존 방어에서 하지 않았다. 기존 `rendered-html.test.mjs`(511줄)와 `supabase-integration.test.mjs`(525줄)도 이미 500줄을 넘고, 이번에는 기존 기대값만 최소 조정했다. 줄 수는 읽기 전용 `wc -l`로 확인했으며 대상 코드 실행 증거가 아니다.
