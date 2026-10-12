// Visitors arrive from Instagram, TikTok, Facebook and WhatsApp links, often inside the apps' own
// in-app browsers. Those handle plain same-tab https://wa.me links best, may block popups, and some
// refuse to hand off to other apps at all — so there is always a "copy" fallback.

const ua = navigator.userAgent;
export const inApp = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|musical_ly|TikTok|Bytedance|Line\//i.test(ua);
const touch = matchMedia('(pointer: coarse)').matches;
/** Open WhatsApp in the same tab on phones and in in-app browsers, a new tab on desktop. */
export const sameTab = inApp || touch;

if (inApp) {
  document.documentElement.classList.add('in-app');
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="https://wa.me/"]')) a.removeAttribute('target');
}

let toastTimer = 0;
export function toast(text: string) {
  let el = document.querySelector<HTMLElement>('[data-toast]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.dataset.toast = '';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('is-on'), 2600);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older in-app browsers: a selected textarea and execCommand
    const t = Object.assign(document.createElement('textarea'), { value: text });
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

for (const b of document.querySelectorAll<HTMLElement>('[data-copy]')) {
  b.addEventListener('click', async () => {
    const ok = await copy(b.dataset.copy!);
    toast(ok ? b.dataset.copied || 'Скопировано' : 'Не удалось скопировать — номер: ' + b.dataset.copy);
  });
}

for (const b of document.querySelectorAll<HTMLElement>('[data-share]')) {
  b.addEventListener('click', async () => {
    const url = (document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || location.origin) + '?utm_source=share&utm_medium=referral';
    const data = { title: 'Трансфер по Кыргызстану — водитель Нурбек', text: 'Трансфер и такси из Бишкека по всему Кыргызстану: Toyota Sienna на 7 мест.', url };
    if (navigator.share) {
      try { await navigator.share(data); } catch { /* closed the sheet */ }
    } else if (await copy(url)) {
      toast('Ссылка скопирована — отправьте её друзьям');
    }
  });
}
