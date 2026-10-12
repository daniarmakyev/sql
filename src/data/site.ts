export const PHONE_DISPLAY = '0556 07 07 21';
export const PHONE_E164 = '+996556070721';
export const TEL = `tel:${PHONE_E164}`;

/** wa.me link, optionally with a prefilled message. */
export function waLink(text?: string): string {
  const base = `https://wa.me/${PHONE_E164.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export const WA_HELLO = waLink('Салам, Нурбек! Хочу заказать трансфер.');

export const DRIVER = { name: 'Нурбек', fullName: 'Нурбек Бакмаматов' };

export const SOCIAL = [
  { id: 'instagram', name: 'Instagram', handle: '@transferkg.312', url: 'https://www.instagram.com/transferkg.312/' },
  { id: 'facebook', name: 'Facebook', handle: DRIVER.fullName, url: 'https://www.facebook.com/nurbek.bakmamatov' },
  {
    id: 'lalafo',
    name: 'Lalafo',
    handle: 'объявление',
    url: 'https://lalafo.kg/bishkek/ads/miniven-punkt-naznacenia-aeroport-manas-kolicestvo-mest-4-licenzia-no-528286382-id-117208403',
  },
] as const;
export const INSTAGRAM = SOCIAL[0];

export const SITE = {
  name: 'Трансфер по Кыргызстану — водитель Нурбек',
  short: 'Нурбек · Трансфер',
  title: 'Трансфер и такси по Кыргызстану — Нурбек | Бишкек, Манас, Иссык-Куль',
  description:
    'Трансфер и такси из Бишкека: аэропорт «Манас», Иссык-Куль, Каракол, Ала-Арча, Чон-Курчак, Токтогул, Ош. Toyota Sienna на 7 мест, багажный бокс, 24/7. Цена договорная.',
};

/** Shown on the page and sent as FAQPage structured data. */
export const FAQ = [
  {
    q: 'Сколько стоит трансфер?',
    a: 'Цена договорная: она зависит от маршрута, даты и числа пассажиров. Напишите маршрут в WhatsApp — Нурбек сразу назовёт стоимость, до поездки.',
  },
  {
    q: 'Как заказать поездку?',
    a: 'Напишите в WhatsApp или позвоните по номеру 0556 07 07 21: откуда, куда, дата, время и сколько вас. Ещё проще — заполнить заявку на этой странице, сообщение соберётся само.',
  },
  {
    q: 'Сколько человек и багажа поместится?',
    a: 'Toyota Sienna рассчитана на 7 пассажиров. Для чемоданов есть багажник и дополнительный бокс на крыше.',
  },
  {
    q: 'Встречаете в аэропорту «Манас» ночью или рано утром?',
    a: 'Нурбек на связи 24/7. Напишите номер рейса и время прилёта — он подтвердит встречу в аэропорту.',
  },
  {
    q: 'Куда можно поехать из Бишкека?',
    a: 'По всему Кыргызстану: Иссык-Куль (Чолпон-Ата, Бостери), Каракол, Ала-Арча, Чон-Курчак, Токтогул, Нарын, Джалал-Абад, Ош и другие направления — встреча в аэропорту, на вокзале или в любом районе Бишкека.',
  },
  {
    q: 'Можно забронировать заранее?',
    a: 'Да. Договоритесь о дате и времени заранее — особенно если едете в выходные или летом на Иссык-Куль.',
  },
];
