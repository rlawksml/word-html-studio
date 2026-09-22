# Sites 배포 소스 경계 (#77)

## 결정

GitHub monorepo는 유지한다. 앱을 최상위로 이동하면 CI·migration·backup 도구의 저장소 상대 경로가 깨지며 확장성 이득도 없다. 대신 검증된 커밋의 `apps/web` Git tree에서 배포 전용 앱 루트를 생성한다. 이 결과물은 개발 저장소를 대체하지 않는다.

```sh
node --test scripts/prepare-sites-source.test.mjs
node scripts/prepare-sites-source.mjs /absolute/path/to/repository <tested-commit>
```

도구는 새 OS 임시 폴더만 생성한다. 미커밋 수정·untracked·로컬 env·node_modules를 복사하지 않는다. 추적된 env/키 파일·생성 폴더·symlink/submodule·운영 project_id는 거부한다. 모든 앱 파일은 Git blob의 바이트를 그대로 쓰고 SHA256을 재확인한다. `deployment-provenance.json`에 원본 commit, 앱 tree, 파일별 hash를 남긴다. 임의 소스 내용의 모든 비밀을 탐지하는 도구는 아니므로 기존 secret scan은 계속 필요하다.

## 검사 위치

- GitHub 원본: 전체 TC·migration·backup 정책·CI. 일부 테스트는 저장소의 `.github`를 참조하므로 추출물에서 전체 npm test를 실행하지 않는다.
- `migration:check`와 `backup:supabase`도 원본 monorepo에서만 실행한다. 추출 앱에 들어 있어도 상대 경로 가정이 다르므로 배포 앱에서 운영 도구로 사용하지 않는다.
- 추출 앱: lockfile 설치, typecheck, build 및 archive 검증. 앱 내용 hash와 provenance를 원본에 대조한다.
- Sites: 별도의 source commit과 GitHub 원본 commit은 다를 수 있다. 두 SHA와 app tree 대응을 릴리스 보고서에 함께 기록한다.

## 아직 해결되지 않은 bootstrap 제약

Sites 0.1.70 공식 workflow는 **기존 원격 소스를 여는 단계부터** root manifest를 강제 검사한다. 현재 원격은 monorepo라 local adapter만으로 이 검사를 통과하지 못한다. 따라서 이 도구는 로컬 준비 도구이며 push·version save·deploy·환경변수 변경을 수행하지 않는다. 공식 하위 경로 지원 또는 플랫폼의 기존 소스 전환 지원 없이는 현 사이트에 적용 완료라고 간주하지 않는다. workflow를 수정하거나 source 응답을 위조하거나 force push하지 않는다.

Staging version15 및 기존 원격 source3b02f1a는 보존한다. Supabase·Storage·DB schema는 변경하지 않는다. 운영 배포·GitHub merge는 별도 승인 대상이다.

## publish 전 필수 후속 gate

현재 hash 확인은 export 직후에만 수행한다. 향후 실제 발행에 연결하기 전에 원본 Git tree와 배포 직전 파일의 누락·추가·symlink·mode·hash를 다시 대조하는 검증기를 추가해야 한다. 현재 도구는 publish-ready가 아니다. 작업 폴더가 dirty여도 명시한 커밋만 추출하는 것이 의도된 동작이며, 미저장 내용이 포함되지 않는다는 점을 provenance와 작업 보고서에서 명확히 한다.
