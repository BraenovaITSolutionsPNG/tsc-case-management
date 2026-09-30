export const ENV = {
  // Vite exposed client-visible config as VITE_*; Next only inlines
  // NEXT_PUBLIC_* into the browser bundle, so the server reads the same names.
  appId: process.env.NEXT_PUBLIC_APP_ID ?? process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /**
   * Whether object storage falls back to the local disk.
   *
   * S3 is the real backend and is used whenever the Forge credentials are set.
   * On a development machine they usually are not, and refusing to start an
   * upload because of it makes the platform impossible to exercise - so
   * development with no credentials writes to a directory under the project
   * instead.
   *
   * Gated on `!isProduction` deliberately and not merely on the credentials
   * being absent: a deployed instance must never quietly accept uploads into
   * its own filesystem, where they would be lost on the next deploy and would
   * not be the same object the database key promises. Production with no
   * credentials is a misconfiguration and fails loudly instead.
   */
  get useLocalStorage() {
    return !this.isProduction && !this.forgeApiUrl;
  },
  // Local development only. The Manus OAuth portal is unreachable from a dev
  // machine, so /api/dev/login mints a session straight from these instead.
  devLoginOpenId: process.env.DEV_LOGIN_OPEN_ID ?? "",
  devLoginName: process.env.DEV_LOGIN_NAME ?? "",
  devLoginEmail: process.env.DEV_LOGIN_EMAIL ?? "",
  devLoginRole: process.env.DEV_LOGIN_ROLE ?? "",
};
