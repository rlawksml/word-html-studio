# #77 스테이징 진입점 경로 검증

## 원인과 변경

Wrangler 4.129.1은 main을 basename으로 업로드하지만 추가 모듈은 base_dir 상대 이름을 유지한다. 기존 worker/staging-entry.mjs의 ../dist import가 원격 루트 밖을 가리켜 code10021이 발생했다. 앱 루트 staging-entry.mjs로 이동하고 ./dist 및 ./worker imports로 통일했다. 공개 URL, secret, DB 및 운영 설정은 변경하지 않았다.

## TC 및 결과

- 전체 앱 회귀(build 포함): 87/87 PASS.
- 스테이징 config/gate/assets/Miniflare/업로드 구조: 36/36 PASS.
- CF-STAGE-05: main basename 및 import 경계/파일 존재 확인.
- STAGE-UPLOAD-01: 실제 Wrangler dry-run outdir entry에서 application/gate/assets 파일 해결 PASS. 테스트 생성 임시 디렉터리만 finally에서 정리.
- lint, typecheck, dry-run, diff-check PASS.
- 사전 원격 조회: 배포 목록 비어 있음, secret list Worker not found.
- 독립 안전 검토: 비공개 artifact bootstrap만 조건부 GO. 전체 공개/DB 통합은 NO-GO.

운영 데이터·DB·Storage·사용자 세션 변경 없음. 테스트는 로컬 합성 fixture만 사용. 실제 로그인/DB/브라우저 TC는 BLOCKED로 유지한다.

## 원격 재시도 결과

- 코드 68480cb: Worker upload 성공, startup 10ms. 경로 오류10021 해소 확인.
- 이후 subdomain API에서 이메일 인증10034 재발, 전체 deploy 명령 exit1. 이메일 문제가 완전히 해소됐다는 이전 판단을 정정한다.
- 사후 deployments list: 버전 `3bf4ae39-d57e-4d23-8dc9-3cfef406f195`, tag `68480cb`, 100% 등록 확인. secret list `[]`.
- 따라서 Worker 미생성이 아닌 **코드 배포 부분 성공 / 서브도메인 설정 실패** 상태다. config의 공개/preview/routes는 off이나 실패한 원격 subdomain 설정의 최종 상태는 아직 확인하지 못했다. 공개 URL 정상 동작을 주장하지 않는다. gate secret이 없어 앱 접근은 fail-closed 설계다.
- 임의 삭제/롤백/재시도 반복 없음. 계정 이메일 인증 상태 확인 후 후속 원격 설정을 재개해야 한다. 전체 release는 NO-GO.
