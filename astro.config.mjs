// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Absolute URLs (canonical, Open Graph) need the public origin. On Vercel it comes from the
// system env vars at build time; SITE_URL overrides it once a custom domain is attached.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const site = process.env.SITE_URL || (vercelHost ? `https://${vercelHost}` : 'http://localhost:4321');

const local = (name, cssVariable, file, weight) => ({
  provider: fontProviders.local(),
  name,
  cssVariable,
  fallbacks: ['sans-serif'],
  options: { variants: [{ src: [`./src/assets/fonts/${file}`], weight, style: 'normal' }] },
});

export default defineConfig({
  site,
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
  fonts: [
    // Unbounded with the Kyrgyz letters Ң Ө Ү added (tools/build_fonts.py)
    local('Unbounded KG', '--font-unbounded', 'unbounded-kg.woff2', '200 900'),
    local('Onest', '--font-onest', 'onest.woff2', '100 900'),
    local('Oswald', '--font-oswald', 'oswald.woff2', '200 700'),
  ],
  vite: { plugins: [tailwindcss()] },
});
