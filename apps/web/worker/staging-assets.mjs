// Staging's outer gate must authenticate before this static asset adapter runs.
export function createStagingAssetAdapter(application) {
  return {
    async fetch(request, env, ctx) {
      const isAssetRead = (request.method === "GET" || request.method === "HEAD")
        && new URL(request.url).pathname.startsWith("/assets/");
      if (!isAssetRead) return application.fetch(request, env, ctx);

      try {
        if (typeof env.ASSETS?.fetch !== "function") {
          return new Response("정적 파일을 불러올 수 없습니다.", { status: 503 });
        }
        const response = await env.ASSETS.fetch(request);
        if (response.status !== 404) return response;
        // Release a missing-asset response before giving the app its normal fallback.
        await response.body?.cancel();
      } catch {
        return new Response("정적 파일을 불러올 수 없습니다.", { status: 503 });
      }
      return application.fetch(request, env, ctx);
    },
  };
}
