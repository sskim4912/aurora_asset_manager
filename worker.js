// 서버 진입점: Secret과 GCP 저장 API를 추가할 수 있는 Worker 형태로 실행한다.
// 저장소 전환 전에는 기존 정적 화면만 제공한다.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
