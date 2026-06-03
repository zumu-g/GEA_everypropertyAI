import Fastify from 'fastify';
import { getEngine, defaultEngineName } from './engines/index.js';
import { htmlToMarkdown } from './markdown.js';
import type { ProxyConfig } from './engines/types.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const SECRET = process.env.STEALTH_SCRAPER_SECRET ?? '';

// SSRF guard: only fetch known AU property portals + agency sites. Set
// STEALTH_ALLOWED_HOSTS (comma-separated suffixes) to extend, or "*" to disable
// (NOT recommended in production).
const ALLOWED_HOSTS = (process.env.STEALTH_ALLOWED_HOSTS ??
  'realestate.com.au,domain.com.au,view.com.au,property.com.au,ratemyagent.com.au,oldlistings.com.au,homely.com.au,homehound.com.au,example.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isUrlAllowed(rawUrl: string): boolean {
  if (ALLOWED_HOSTS.includes('*')) return true;
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

interface ScrapeBody {
  url?: string;
  waitFor?: string | number;
  timeout?: number;
  engine?: string;
  proxy?: ProxyConfig;
}

const app = Fastify({ logger: true, bodyLimit: 1_048_576 });

// Bearer-token auth on everything except /health.
app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!SECRET) return; // no secret configured → open (dev only)
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${SECRET}`) {
    reply.code(401).send({ status: 'failed', error: 'Unauthorized' });
  }
});

app.get('/health', async () => ({ ok: true, engine: defaultEngineName() }));

app.post<{ Body: ScrapeBody }>('/scrape', async (req, reply) => {
  const { url, waitFor, timeout, engine, proxy } = req.body ?? {};

  if (!url || typeof url !== 'string') {
    return reply.code(400).send({ status: 'failed', error: 'url is required' });
  }
  if (!isUrlAllowed(url)) {
    return reply.code(403).send({ status: 'failed', error: 'url host not allowed' });
  }

  const selected = getEngine(engine);

  try {
    const { html, finalUrl } = await selected.fetchPage(url, { waitFor, timeout, proxy });
    const markdown = htmlToMarkdown(html);
    return reply.send({ status: 'success', html, markdown, finalUrl, engine: selected.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scrape error';
    const isTimeout = /timeout|timed out/i.test(message);
    req.log.error({ url, engine: selected.name, err: message }, 'scrape failed');
    return reply.send({ status: isTimeout ? 'timeout' : 'failed', error: message });
  }
});

app
  .listen({ port: PORT, host: HOST })
  .then((addr) => app.log.info(`stealth scraper listening on ${addr} (engine: ${defaultEngineName()})`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
