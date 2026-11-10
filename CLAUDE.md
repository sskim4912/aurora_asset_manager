# 작업 규칙 — Aurora Asset Manager (비품관리 전용)

> **이 규칙은 비품관리(Aurora Asset Manager) 전용이다.**
> 다른 프로젝트(영수증, 식사, 허가, 포털 등)의 파일과 코드는 **이 저장소에 저장하지 않는다.**
> 다른 프로젝트 작업은 각자의 저장소에서 한다.

## 1. 저장소
- 비품관리의 모든 코드와 데이터는 **`sskim4912/aurora_asset_manager`** 에만 저장·수정한다.
- 업로드(push)는 **main 브랜치**에 한다. GitHub Pages가 main에서 바로 사이트를 만든다.
  - 사이트 주소: https://sskim4912.github.io/aurora_asset_manager/
- 올리기 전에 매번 확인한다.
  1. 대상 저장소가 `sskim4912/aurora_asset_manager` 인지 (`git remote -v`)
  2. 바뀌는 파일 목록 (`git status`, `git diff --stat`)
  3. 원격의 최신 내용을 먼저 받은 뒤 그 위에 올린다 (`git fetch` 후 `git rebase origin/main`) — 앱이 수시로 `assets.json` 커밋을 만들기 때문
- 사용자가 이름을 콕 집어 요청하지 않는 한, 다른 저장소에는 손대지 않는다.

## 2. 파일
| 파일 | 내용 | 규칙 |
|---|---|---|
| `index.html` | 화면과 기능 전부 (단일 파일) | 코드 수정은 이 파일에서만 |
| `assets.json` | 자산 데이터 | **절대 직접 수정·삭제하지 않는다.** 데이터는 앱에서만 바뀐다 |
| `CLAUDE.md` | 이 작업 규칙 | |
| `README.md` | 저장소 소개 | |

- 새 파일은 꼭 필요할 때만, 사용자에게 먼저 묻고 만든다.

## 3. index.html 구성
- [1] 기본 설정 `CONFIG` — 비밀번호 해시, 카카오 키, 저장소 정보
- [2] 데이터 저장소 `Store` — GitHub `assets.json` 읽기·쓰기 (12월 Firebase 이전 시 이 구역만 교체)
- [3] 로그인 · [4] 화면(현황/자산/지도/라벨) · [5] 상세·등록 패널 · [6] 엑셀 · [7] 설정·시작
- 라이브러리: SheetJS, qrcodejs (cdnjs), Kakao Maps SDK, Pretendard 글꼴

## 4. 고정 정보
- 관리자 비밀번호: 해시로만 저장 (`CONFIG.PW_HASH`). 평문을 코드에 넣지 않는다.
- 카카오 JavaScript 키: `77c97bf1b0283e37f4ca3c548d45e5e6` (등록 도메인: `https://sskim4912.github.io`)
- GitHub 토큰: 각 기기 브라우저에만 저장. **코드·데이터·커밋에 절대 넣지 않는다.**
- 라벨: 7×7cm, A4(2×4=8칸) / A3(3×5=15칸), 용지 가운데 배치, QR 오류보정 H
- 자산번호: `AUR-001` 형식, 자동 부여. 삭제 대신 상태를 '폐기'로 바꾼다.

## 5. 작업 방식
- 사용자 컨셉: **누구나 쉽게, 빠르게, 편하게.** 꼭 필요한 정보만 남기고 나머지는 간략하게.
- 사용자와는 **한국어**로 대화한다.
- 커밋 메시지에는 무엇을 바꿨는지 한국어로 적는다.
- 수정 후에는 브라우저로 동작을 확인하고, 결과를 사용자에게 알린다.

## 6. 예정
- 2026년 12월: 데이터를 Firebase(Firestore)로 이전하고 진짜 로그인 보안을 붙인다.
  이전 후 GitHub 토큰(aurora-asset-manager)을 삭제한다.
