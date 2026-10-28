// The "same book" rule lives in convex/bookIdentity.ts so the server and the
// client share one copy. Re-exported here for the components that already import it.
export { bookKey, bookKeys, inKeySet, keySetOf, sameBook } from "@/convex/bookIdentity"
