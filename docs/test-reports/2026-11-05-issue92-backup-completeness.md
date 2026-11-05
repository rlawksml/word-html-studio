# #92 백업 완전성 — RED → 수정 → 격리 GREEN

## 판정

**#92 파일 기반 검증 범위 GO / 전체 운영 NO-GO.** 실제 Supabase 백업·복원이나 브라우저 검증 결과가 아니다.

- 브랜치: `codex/m1-backup-completeness`
- 수정 전: `4c8b230b276bd2d0fda7a4567aa8e7290672a6d9`
- 수정·검증 코드: `9497d1bf55a4eb7629955b4a5760cb685dc5e496`
- 운영/보관 Staging/기존 QA 자료·사진·환경·배포 변경0. main merge·유료 전환0.

## 원인과 수정 경계

기존 verifier는 manifest에 적힌 파일만 검사하고 핵심 테이블·사진 버킷 누락을 강제하지 않았다. 사진 참조도 검증한 DB JSON에서 다시 계산하지 않아 누락 신고를 빈 목록으로 만들면 해당 검사가 빠질 수 있었다. 복원 테이블 selector도 부분 목록을 허용했다. 기존 성공 fixture 자체가 책방 테이블 하나만 가진 점을 발견했다.

- 새 순수 `backup-manifest-policy.mjs`로 필수 core4 테이블·원본/미리보기 버킷2개, marker/range 묶음·digest capability, 완료 시각·fingerprint 모양·숫자/해시·중복 경로·집계의 일관성을 확인한다.
- 읽은 파일의 크기/해시/JSON 검증에 실패하면 사진 참조 검증 성공으로 승격하지 않는다.
- 검증한 Submission JSON에서 참조 수·중복/고유 경로·누락/미참조를 재계산해 manifest 신고와 대조한다.
- 잘못된 형식·목록·파일에는 고정 실패 코드로 FAIL을 반환한다. raw 사용자 행·경로·예외 원문을 진단에 넣지 않는다.
- `tableSpecsForRestore`도 핵심4/선택 묶음 누락을 거부한다. 원문 DB/사진/미래 JSON 필드는 다시 쓰거나 삭제하지 않는다.
- 정상 legacy/modern/digest, 0행/0사진과 같은 합법적인 빈 데이터는 허용한다. `bookstore-news` legacy 버킷은 선택이며, 선언에서 빠진 외부 버킷이 실제로 존재하지 않는다는 증거까지 제공하는 것은 아니다.
- 모르는 신규 schema marker는 명시적 정책 갱신 전 차단한다. fingerprint는 실수 방지 식별자이며 신원 인증이 아니다.

## 실제 실행 증거

| 단계 | 정확한 run / job | 실제 결과 |
|---|---|---|
| 수정 전 RED | [41992218969](https://github.com/rlawksml/word-html-studio/actions/runs/41992218969) /127126923220 | 29등록, PASS10/FAIL19, 취소·skip·todo0, exit1 |
| 같은29TC GREEN | [41993479402](https://github.com/rlawksml/word-html-studio/actions/runs/41993479402) /127131043045 | 29PASS, failures0/skips0, 소유 자원 정리 확인 |
| 기존 복원 정책 | [41993491712](https://github.com/rlawksml/word-html-studio/actions/runs/41993491712) /127131065751 | 25PASS, failures0/skips0, 소유 자원 정리 확인 |
| 전체 앱 | [41993506064](https://github.com/rlawksml/word-html-studio/actions/runs/41993506064) /127131118874 | type/lint/build exit0, **276/276 PASS**, fail/cancelled/skipped/todo0, 정리 후 COMPLETE |

RED의 실패 ID는01~12·14~18·25·28이다. 정상 테스트 종료값1/preflight 확인/실행 소유 정리 marker를 확인했으므로 timeout·출력 상한·환경 기동 실패와 구분된다. 일부 TC의 순차 변형은 첫 실패 뒤 실행되지 않았으며 RED에서 모든 하위 변형을 실행했다고 세지 않는다.

GREEN은 새 테스트/fixture의 원래 해시를 그대로 유지했다. 기존3개 테스트 변경은 불완전 fixture를 완전하게 하고 부분 목록 거부·미래 metadata 불변 assertion을 보강한 것이다. 기대를 완화하거나 실패 TC를 제거하지 않았다. 29·25·276과 과거247/99는 중복이 있어 합산하지 않는다.

### TC 매핑

| TC | 요구 | 최종 |
|---|---|---|
| BACKUP-COMPLETE01~09 | 빈/핵심누락·선택 묶음·digest marker·필수 버킷 | PASS |
| 10~16 | 시각/fingerprint·알 수 없는 목록·metadata·집계/중복·참조 위조 | PASS |
| 17~20 | 실제 참조 누락·정확한 누락 신고·미참조 사진 보존 차단 | PASS |
| 21~24 | 정상 legacy/modern/digest·미래 row 원문 불변·변조/INCOMPLETE | PASS |
| 25~29 | 잘못된 news/image·참조 재사용·legacy 버킷·빈 marker·workspace001 | PASS |

## 실행 환경·최종 지문

무료 공개 표준 Linux에서 기존 검토 경계를 유지했다. native29/25는 SDK·키·DB·의존성 설치 없이 network-none/비루트/RO source·도구/제한 scratch에서 실행했다. 전체 앱은 기존 lock의 무스크립트·무키 prep→망분리/RO 인계·prep 부재→오프라인 실행 순서다. 앱 코드나 npm 스크립트를 호스트에서 실행하지 않았다.

최종 앱은 08:20:09.0518833Z 실제276 카운터, 08:20:09.5584344Z 정리 뒤 COMPLETE를 확인했다. strict 자식 종료·OS/컨테이너 최종 점검·정확한 실행 소유 자원 정리 조건을 완화하지 않았다. native29/25도 각각 PASS 뒤 정리 marker가 있다. 주 담당과 독립 검토자가 metadata·실제 고정 출력·소스 완료 조건을 대조했다.

- source SHA-256: `ec84bf7db18aa6dd60faf634fe3d0674a1f2d566b4b792f3c43a9a0daf54588c`
- package: `cbc8bc1cb6ab5c4a4ce1c3a702079b743510f679cf80606822044322a1c70d9d`
- lock: `18ff641e6f54f79d3c6158ba8717309e7e0e237eb65d7fdff6012b39d1433f34` (의존성 변경 없음)
- 재현 test: `141dc6c058f17ae4177dd36d286ad2c30ea7df5767059d98a3a0302ba3cd9857`
- fixture: `5686f7dccaac52321a4101dd25cebc61a8e70b85f1c9b5ca6bc86dc9d53447ff`

unit stdout64690bytes/stderr0. 64KiB 상한까지846bytes가 남으므로 추가 TC 전에 별도 출력 요약 설계를 검토해야 한다. 상한을 올리거나 테스트를 줄이지 않았다. npm/build의 관측 warning 각각2는 여전히 미분류다.

## 정리와 미검증

- 파일 fixture는 컨테이너 scratch의 이번 호출 전용 mkdtemp만 만들고 정리했다. 기존 백업/업무 행/사진을 대상으로 하지 않았다.
- #93 ancestor symlink/TOCTOU 방어는 미완료다. 이 결과를 실제 백업 경로 안전성 보증으로 사용하지 않는다.
- #94 의도적인 미참조 보관 사진은 기존처럼 blocker다. 이번 변경은 정책 완화나 물리 삭제 허가가 아니다. 사진을 삭제해 검사를 통과시키지 않는다.
- 필수 목록과 파일 내 일관성은 실제 외부 프로젝트의 전체 목록·동시 쓰기 중 원자 snapshot·SQL DDL·모든 관계 무결성을 입증하지 않는다.
- #87 audit/업데이트, 브라우저·실DB/Storage P0, 최신 독립 백업·새 빈 대상 실제 복원, exact fallback·환경 보존·최종 사용자 운영 승인은 남아 있다.
- 보고서-only 후속 커밋은 위 검증 코드 SHA를 대체하지 않는다. 이슈는 운영 반영과 분리해 열어 둔다.
