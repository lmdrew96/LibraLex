/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as backfill from "../backfill.js";
import type * as books from "../books.js";
import type * as catalog from "../catalog.js";
import type * as crons from "../crons.js";
import type * as discover from "../discover.js";
import type * as discoverCache from "../discoverCache.js";
import type * as embed from "../embed.js";
import type * as enrich from "../enrich.js";
import type * as friends from "../friends.js";
import type * as gemini from "../gemini.js";
import type * as googleBooks from "../googleBooks.js";
import type * as http from "../http.js";
import type * as mcpAuth from "../mcpAuth.js";
import type * as mcpData from "../mcpData.js";
import type * as migrations from "../migrations.js";
import type * as normalize from "../normalize.js";
import type * as recs from "../recs.js";
import type * as search from "../search.js";
import type * as shelf from "../shelf.js";
import type * as shelfAdd from "../shelfAdd.js";
import type * as tasteVector from "../tasteVector.js";
import type * as users from "../users.js";
import type * as util from "../util.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  backfill: typeof backfill;
  books: typeof books;
  catalog: typeof catalog;
  crons: typeof crons;
  discover: typeof discover;
  discoverCache: typeof discoverCache;
  embed: typeof embed;
  enrich: typeof enrich;
  friends: typeof friends;
  gemini: typeof gemini;
  googleBooks: typeof googleBooks;
  http: typeof http;
  mcpAuth: typeof mcpAuth;
  mcpData: typeof mcpData;
  migrations: typeof migrations;
  normalize: typeof normalize;
  recs: typeof recs;
  search: typeof search;
  shelf: typeof shelf;
  shelfAdd: typeof shelfAdd;
  tasteVector: typeof tasteVector;
  users: typeof users;
  util: typeof util;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
