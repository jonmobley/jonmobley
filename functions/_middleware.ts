// _routes.json sends the repo's source folders here as well as /api, so they are
// never served as files. Anything that isn't /api gets a plain 404.
export const onRequest: PagesFunction = async ({ request, next }) => {
  const path = new URL(request.url).pathname;
  if (path === "/api" || path.startsWith("/api/")) return next();
  // (Source files aren't uploaded at all — scripts/deploy.sh leaves them out. This is a backstop.)
  return new Response("Not found", { status: 404 });
};
