export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// getLoginUrl — safe even if env vars are missing
export const getLoginUrl = (): string => {
  try {
    const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
    const appId = import.meta.env.VITE_APP_ID;
    if (!oauthPortalUrl || !appId || oauthPortalUrl === 'undefined') {
      return '/dashboard';
    }
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(redirectUri);
    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    return url.toString();
  } catch {
    return '/dashboard';
  }
};
