/**
 * Hosts whose CDNs reject the Next.js image optimizer's server-side fetch
 * (hotlink protection against datacentre IPs) while serving browsers fine.
 * Images from these hosts must load directly (`unoptimized`), or they render
 * as broken alt-text (optimizer 403: "upstream response is invalid").
 * Verified live 2026-07-29: www.homely.com.au 403s via the optimizer;
 * domainstatic/reastatic pass.
 */
const OPTIMIZER_BLOCKED_HOSTS = ['homely.com.au'];

/** True when `url`'s host blocks the image optimizer and the <Image> should
 * be rendered with `unoptimized` so the browser fetches it directly. */
export function isOptimizerBlocked(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return OPTIMIZER_BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
