// Validates Clerk-issued JWTs reaching Convex. `domain` MUST equal the Clerk
// instance's JWT issuer (its Frontend API URL). Set per deployment with:
//   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-instance>.clerk.accounts.dev
// so dev (local/cloud) and prod can each point at the right Clerk instance.
// Local dev reuses the shared ADHDesigns dev instance (same one FeyForge uses).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
}
