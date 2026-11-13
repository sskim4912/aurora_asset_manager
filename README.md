# Aurora Asset Manager

화면과 저장 API는 Cloudflare Worker `aurora-asset-manager`에서 실행합니다. 자산 데이터와 사진은 GCP 프로젝트 `api-for-anythingllm-1`의 비공개 버킷 `aurora_asset_manager`에 저장합니다. 서비스 계정 JSON은 Worker Secret `GCP_SERVICE_ACCOUNT_JSON`에만 등록하고 해당 버킷에 Storage Object User 권한을 부여합니다.

배포: 저장소 루트에서 `npx wrangler deploy --keep-vars`. `worker.js`는 서버 코드이며 정적 파일로 배포하지 않습니다. 로컬 개발은 `wrangler dev`를 사용하며 GCP에 접근하려면 별도 개발용 인증을 안전하게 구성해야 합니다. 정적 HTTP 서버만으로는 저장·로그인이 동작하지 않습니다.

서버 세션 로그인 후 `/api/status`로 저장소 연결을 확인할 수 있습니다. `/api/data`의 `X-Generation`을 다음 PUT에 보내며, 충돌은 409로 반환합니다. 매 저장 전 원본은 버킷의 `backups/` 아래에 보관합니다. 사진은 같은 이름의 다른 파일을 덮어쓰지 않습니다.

GitHub의 기존 `assets.json`, `photos/`, `key.json`은 이전 보관본입니다. 현재 운영 데이터로 간주하거나 버킷에 재적용하지 마세요. 서비스 계정 JSON과 토큰은 소스·커밋·로그에 포함하지 마세요.
