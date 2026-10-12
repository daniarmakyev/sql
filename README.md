# Трансфер по Кыргызстану — водитель Нурбек

Лендинг для трансфера и такси из Бишкека по всему Кыргызстану: Toyota Sienna на 7 мест, WhatsApp 0556 07 07 21,
Instagram [@transferkg.312](https://www.instagram.com/transferkg.312/).

Astro 7 (статическая сборка) · Tailwind CSS 4 · AVIF/WebP · свои шрифты (Unbounded с дорисованными Ң Ө Ү, Onest, Oswald) ·
без фреймворков на клиенте: несколько маленьких скриптов (карта маршрутов, заявка в WhatsApp, диалоги).

## Запуск

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # статический сайт в dist/
npm run preview
```

Нужен Node.js 22.12+.

## Деплой на Vercel

1. vercel.com → **Add New → Project** → импортировать этот репозиторий.
2. **Project Name: `transferkg`** — тогда адрес будет `transferkg.vercel.app` (совпадает с Instagram).
   Иначе Vercel возьмёт имя репозитория.
3. Framework Preset определится сам (Astro), настройки сборки менять не нужно — всё в `vercel.json`.
4. После первого деплоя: **Analytics → Enable** (Web Analytics) — будет видно, откуда приходят люди.

Адрес для ссылок, превью и sitemap берётся из `VERCEL_PROJECT_PRODUCTION_URL` автоматически.
Когда появится свой домен, достаточно подключить его в Vercel (или задать `SITE_URL=https://домен`).

## Ссылки для соцсетей

Одна и та же страница, но с меткой источника — так в аналитике видно, какая площадка приводит клиентов.
Замените домен, если он другой.

| Где | Ссылка |
| --- | --- |
| Instagram — шапка профиля | `https://transferkg.vercel.app/?utm_source=instagram&utm_medium=bio` |
| Instagram — сторис (стикер «Ссылка») | `https://transferkg.vercel.app/?utm_source=instagram&utm_medium=stories` |
| TikTok — профиль | `https://transferkg.vercel.app/?utm_source=tiktok&utm_medium=bio` |
| Facebook — пост / профиль | `https://transferkg.vercel.app/?utm_source=facebook&utm_medium=social` |
| WhatsApp — статус / рассылка | `https://transferkg.vercel.app/?utm_source=whatsapp&utm_medium=messenger` |
| Lalafo — в тексте объявления | `https://transferkg.vercel.app/?utm_source=lalafo&utm_medium=ads` |

Превью ссылки (картинка 1200×630, всё важное — в центральном квадрате) задаётся в `tools/og/og.html`.
WhatsApp и Facebook кэшируют превью: после изменений проверьте ссылку в
[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) («Scrape Again»).

## Что внутри

- `src/components/` — секции страницы, `src/data/site.ts` — телефон, соцсети, вопросы-ответы.
- `src/data/geo.json`, `src/data/hero.json` — сгенерированы скриптами, руками не править.
- `tools/` — скрипты, которые собирают ассеты (нужен Python: playwright, pillow, numpy, scipy, scikit-image,
  matplotlib, fonttools, brotli, imageio-ffmpeg; рендеры используют установленный Chrome):
  - `build_fonts.py` — шрифты (сабсеты + кыргызские буквы в Unbounded);
  - `build_assets.py` — карта рельефа и маршруты, слои hero, фото, ролик;
  - `hero-render/render.py` — 3D-кадры машины на дороге (из проекта промо-ролика `~/Desktop/transfer-3d`);
  - `render_og.py` — картинка превью и иконки.
