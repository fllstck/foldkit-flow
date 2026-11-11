import appSource from "./app.ts?raw";

/**
 * The example page shows its own code beside it: the string below is `app.ts`
 * verbatim, not a copy that can drift. It lives in its own module so `app.ts`
 * does not import itself.
 */
export const exampleSource = appSource;
