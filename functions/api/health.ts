/**
 * Cloudflare Pages Function: /api/health
 */

export const onRequestGet: PagesFunction = async () => {
  return Response.json({
    status: "ok",
    platform: "Cloudflare Pages Functions",
    engine: "apple-watch-ecg-ts",
    version: "1.0.0"
  });
};
