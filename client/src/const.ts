export const APP_NAME = "Mar-ia";

export function getLoginUrl(): string {
  const oauthUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthUrl || !appId || oauthUrl === 'undefined' || oauthUrl === '') {
    return '/login';
  }
  try {
    const redirectUri = window.location.origin + '/api/oauth/callback';
    const url = new URL(oauthUrl + '/app-auth');
    url.searchParams.set('appId', appId);
    url.searchParams.set('redirectUri', redirectUri);
    url.searchParams.set('state', btoa(redirectUri));
    url.searchParams.set('type', 'signIn');
    return url.toString();
  } catch {
    return '/login';
  }
}

export function getLogoutUrl(): string {
  const oauthUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  if (!oauthUrl || !appId || oauthUrl === 'undefined' || oauthUrl === '') {
    return '/';
  }
  try {
    const url = new URL(oauthUrl + '/app-auth');
    url.searchParams.set('appId', appId);
    url.searchParams.set('type', 'signOut');
    return url.toString();
  } catch {
    return '/';
  }
}
