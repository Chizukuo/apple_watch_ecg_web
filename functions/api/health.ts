/**
 * Cloudflare Pages Function: /api/health
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const onRequestHead: PagesFunction = async () => {
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
};

export const onRequestGet: PagesFunction = async () => {
  return Response.json(
    {
      status: "ok",
      platform: "Cloudflare Pages Functions",
      engine: "apple-watch-ecg-ts",
      version: "1.1.0",
    },
    {
      headers: CORS_HEADERS,
    },
  );
};
