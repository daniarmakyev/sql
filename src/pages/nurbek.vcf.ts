import type { APIRoute } from 'astro';
import { DRIVER, INSTAGRAM, PHONE_E164 } from '../data/site';

// "Save contact": a vCard the phone opens straight into its address book
export const GET: APIRoute = ({ site }) => {
  const [given, family] = DRIVER.fullName.split(' ');
  const card = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N;CHARSET=UTF-8:${family};${given};;;`,
    `FN;CHARSET=UTF-8:${given} — Трансфер по Кыргызстану`,
    'ORG;CHARSET=UTF-8:Трансфер по Кыргызстану',
    'TITLE;CHARSET=UTF-8:Водитель · Toyota Sienna, 7 мест',
    `TEL;TYPE=CELL,VOICE:${PHONE_E164}`,
    `URL:${new URL('/', site).href}`,
    `X-SOCIALPROFILE;TYPE=instagram:${INSTAGRAM.url}`,
    'NOTE;CHARSET=UTF-8:WhatsApp 0556 07 07 21. Трансфер и такси из Бишкека по всему Кыргызстану\\, 24/7.',
    'END:VCARD',
    '',
  ].join('\r\n');
  return new Response(card, { headers: { 'Content-Type': 'text/vcard; charset=utf-8' } });
};
