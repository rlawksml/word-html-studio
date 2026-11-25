# #87 최소 Next 보안 후보 — 격리 앱 회귀

## 판정

**새 lock의 타입·lint·빌드·기본276TC 범위 GO / 보안 완료·운영 반영 NO-GO.** 감사(audit)와 실제 브라우저·DB·백업·fallback 호환은 별도다.

- 검증 코드: `bae02fb72ead590df3e6afdf79f5a66c3a81cfc7`
- 브랜치: `codex/m1-next-security-update`, 기준 `edf17ab53abc1aab21de9716655274ed7c10cbe6`
- 실제 run [42002180281](https://github.com/rlawksml/word-html-studio/actions/runs/42002180281), 앱 job `127159918342`
- main merge·운영/Staging 배포·SQL·기존 DB/사진·과금 변경0.

## 수정 경계

검토한 공개 전달물 두 JSON을 별도 후보에 적용했다. 직접 선언 변경은 Next·eslint-config-next16.3.4→16.4.5 두 필드뿐이다. baseline의 두 입력 지문과 workflow의 baseline pin을 같이 갱신했으며, 앱 로직·테스트 목록/기대·다른9개 helper·격리 조건은 그대로다.

lock735레코드 중42변경/693동일/추가0/삭제0. 비root41레코드의40개 고유 package/version은 공식 registry name/version·dist URL/SRI·dependencies·optionalDependencies와 독립 대조했다. Next/sharp closure 밖의 원치 않은 변경은 관측되지 않았다. semver7.8.5→7.8.6은 resolver가 선택한 범위 내 patch 부수 변경이다. metadata 도구는 이 브랜치에 포함하지 않았다.

## 실제 TC 결과

| TC / 단계 | 결과 | 실제 증거 |
|---|---|---|
| NEXT-LOCK-01 무스크립트 설치 | PASS | exit0, signal/error/limited 없음, warning 관측2 |
| NEXT-APP-01 타입 검사 | PASS | exit0, stdout/stderr0 |
| NEXT-APP-02 lint | PASS | exit0, stdout/stderr0 |
| NEXT-APP-03 build | PASS | exit0, warning 관측2 |
| NEXT-APP-04 기존27파일 전체 회귀 | PASS | tests276/pass276/fail0/cancelled0/skipped0/todo0 |
| NEXT-APP-05 엄격 종료·소유 자원 정리 | PASS | 최종 점검·정리 후09:26:03.9202052Z COMPLETE |
| NEXT-SEC-01 production audit | BLOCKED | 안전한 metadata-only 실행 경로·실제 증거 미확보. 이 앱 실행에 포함하지 않음 |
| NEXT-UI-01 실제 브라우저/Network·메모리 | BLOCKED | 신뢰 가능한 Linux browser runtime 확보 필요 |
| NEXT-DATA-01 실DB/Storage·fallback | BLOCKED | 공유 데이터/SQL/배포를 변경하지 않음 |

09:26:03.3642434Z 실제276 카운터 뒤 최종 점검과 정리를 거쳐 COMPLETE가 출력됐다. 기본276과 별도 metadata24·backup29/restore25·과거247/99는 중복·범위 차이가 있어 합산하지 않는다. 일반 verify와 Supabase integration job은 수동 격리 실행에서 의도적으로 SKIPPED였고 성공으로 세지 않는다.

## 최종 지문·제약

- source SHA-256: `b561e42c927c1a0c62d39a7ac8471bf27f16fbba08e16ef8f96d9f9764bda90e`
- package: `4b79c8d63413e685bbe8d04b199ff976c99c24b8257e9e66d5861f58e2eaf5e8`
- lock: `bcd90db9e993e0dc5ec270cfe9efc141e783f3a7a5682236d33ce1a3dde029fe`
- baseline: `75d3223b3d0e0932fdbeb798f424f00b3fd656777c28e812acb8868fd35d6ce1`
- unit stdout64684bytes/stderr0. 64KiB까지852bytes 여유다. 상한을 올리거나 TC를 줄이지 않았다.
- npm/build 관측 warning 각2는 미분류다. exit0을 경고 부재·안전성으로 확대하지 않는다.
- production source-map-js1.2.1과 개발 Miniflare의 sharp0.35.2는 유지된다. React19.2.8·vinext0.0.50의 별도 #66 호환/보안 검증도 남는다.

공개 무료 표준 Linux에서 무키·무스크립트 prep→망 분리·RO 인계→prep 부재→오프라인 앱 실행을 적용했다. npm/app/대상 테스트를 로컬 Mac 호스트에서 실행하지 않았다. 애플리케이션 API/실 Storage/공유 DB 연결·artifact 업로드는 없다. 실행 소유 컨테이너·볼륨만 정리했고 기존 QA/업무 자료는 건드리지 않았다.

## 배포를 막는 별도 게이트

- #46/#48: [정확한 옛 fallback의6TC 중4FAIL](https://github.com/rlawksml/word-html-studio/blob/0fec8b719a88001b61b54b31238bb28472757628/docs/test-reports/2026-11-05-exact-fallback-preservation.md). 미래 news/image/extra/link 필드 보존 실패다. 현재 후보 PASS로 옛 배포 호환을 승인하지 않는다.
- #75/#91: [Linux inventory의 부모 경로 쓰기 권한 검사가 차단](https://github.com/rlawksml/word-html-studio/blob/2aff470a15e7dd58b0824d9053452cb8d9c63c0f/docs/test-reports/2026-11-05-browser-runtime-inventory.md). 실제 브라우저 테스트는 실행하지 않았다.
- #93/#94: 경로 symlink/TOCTOU와 미참조 사진 보존 정책은 #92 완전성 수정과 별개로 미완료다.
- #47/#86/#88: 최신 독립 백업·새 빈 대상 복원·통합본 SQL/동시 편집·사진 실 시나리오는 별도 승인과 격리 환경 증거가 필요하다.

따라서 이슈를 닫거나 PR/merge/배포하지 않는다. 앱 롤백 시에도 최신 DB·사진을 유지하며, 백업 덮어쓰기·down migration·사진 삭제를 롤백 절차에 섞지 않는다.
