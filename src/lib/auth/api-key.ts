/**
 * Constant-time API-key check for the middleware gate. Edge-runtime safe
 * (no node:crypto): every candidate key is compared in full, and each string
 * comparison touches every character, so timing does not leak prefix matches.
 */
export function isAuthorizedApiKey(provided: string | undefined, keys: string[]): boolean {
  if (!provided || keys.length === 0) return false;
  let match = 0;
  for (const key of keys) {
    let diff = provided.length ^ key.length;
    for (let i = 0; i < provided.length; i++) {
      diff |= provided.charCodeAt(i) ^ key.charCodeAt(i % Math.max(key.length, 1));
    }
    if (diff === 0) match = 1;
  }
  return match === 1;
}
