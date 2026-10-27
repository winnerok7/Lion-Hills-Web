# Lion Hills — быстрая дока

Одностраничный промо-лендинг ЖК **Lion Hills** (виллы и пентхаусы, Лісники, Київ). Тексты на **украинском** (`lang="ru"` в html — неточность). Статика без сборки: открывается `index.html` напрямую или любым static-сервером. Не git-репозиторий.

## Файлы
| Файл | Что внутри |
|---|---|
| `index.html` (~710 строк) | Вся разметка. Сверху лоадер (`#loader`), затем `.main_section`: плавающий хедер `.sticky_header` (+ `.sticky_fade`), стеклянное меню `.drawer`, плашка `.plan_download`, дальше секции. |
| `style.css` | Все стили. Десктоп сверху, мобилка одним блоком `@media (max-width: 767px)` в конце. Ближе к концу десктопа: FAQ, outro + футер, анимации, лоадер. |
| `scripts.js` | UI-компоненты (vanilla JS): `.gallery`, `.carousel`, `.stories`; плавающий хедер (появление после hero + раскрытие в меню), плашка скачивания планировок, `.drawer` (меню hero на десктопе, время Києва), FAQ-аккордеон, форма футера (заглушка), цвет `.sticky_fade` (тёмный только над `.clubhouse`). |
| `animations.js` | GSAP 3.13 + ScrollTrigger + SplitText + Lenis (CDN в конце index.html). `intro()` — лоадер + шторка hero (стартует сразу); `init()` — scroll-эффекты после `fonts.ready` (макс. 2с). Ещё `footerReveal()` и `setupSnap()`. Lenis отдаётся в `window.lenis` (для якорей меню). |
| `variants/cards-v2/` | Сохранённый альтернативный `animations.js` (другой snap). Старый: без `intro()`/лоадера и `footerReveal` — поверх не копировать. |
| `fonts/` | Aeonik Pro (400/500/900) — основной; PP Hatton 500 — акцентный (лого). |
| `media/` | Фото/видео. Пробелы и кириллица в путях. На сайте используются **сжатые** версии: `LH media/<раздел>/Compressed/` (картинки Penthouses/Автономність — из `Compressed/Webp/`, Внутрішня інфр — из `Compressed/Webp 2/` (там в основном `.jpg`), видео `Villas` — `.webm`), Переваги — `Переваги/Resized & Cropped/Compressed/` (в HTML `&amp;`), build1/2 — `Готові юніти/Desktop/Compressed/`, hero — `hero2_compressed.jpg`. Медиа вилл — `VillaN/Desktop/` (у Villa5 папка `Dekstop`), фото и видео сторис — из `VillaN/Desktop/Compressed/` (у Villa5 — `Dekstop/Compressed/`), мобильные версии будут отдельно. Оригиналы лежат рядом, на сайт не подключены. |

## Порядок секций (index.html)
1. `.hero` — `.hero_media` (фото фоном, отдельный слой для параллакса), хедер (лого, телефон, «Меню»), заголовок, «Лісники, Київ», белая кнопка «Запис на перегляд»
2. `.white_card` → `#concept` `.architecture` и `#location` `.benefits` (галерея «Концепція»)
3. `#infrastructure` `.clubhouse` — тёмная карусель инфраструктуры
4. `.white_card_next` → `#villas` `.villas` → `.ready` → `.types` (5 `.stories`-баннеров вилл с планировками) → `.villas_cta`
5. `#autonomy` `.clubhouse` — «Автономність та безпека»
6. `.white_card_next` → `#penthouses` пентхаусы → `.lots` (4 карточки) → `.ready` → `#build` `.build` → `#faq` `.faq` → `.outro` (большой текст) → `.footer`

## Интро (лоадер)
Серый экран `#eaeaea`: в центре из blur выходит лого `.loader_logo` и уходит, затем на его месте фраза «Життя на висоті. Лісники, Київ» собирается по частям в одну строку (мобилка: все 3 части сменяют друг друга по одной, без точки), линия `.loader_frame` едет по краю экрана + счётчик %. Затем `.hero` (z-index выше лоадера, пока `html.is-loading`) открывается `clip-path` снизу вверх с параллаксом фото, следом строки заголовка (SplitText с маской), подзаголовок/хедер, кнопка. Лоадер **динамический**: линия и % идут за `window.loadProgress()` (критичный набор, см. «Загрузка медиа»), со сглаживанием и не быстрее одного круга за 2.4с; шторка стартует, когда линия дошла до 100% (+0.3с). В конце лоадер удаляется, снимается `is-loading`, стартует Lenis. Без GSAP или при reduced-motion лоадера нет (`bail()`).
- Пауза таймлайна сделана через `tl.call` + `tl.pause()`: `addPause` с колбэком в GSAP 3.13 колбэк не вызывал.
- Headless Chrome с `--virtual-time-budget` не годится для проверки таймлайна: виртуальное время бежит быстрее кадров GSAP.

## Загрузка медиа
Все `<img>`/`<video>` ниже hero — с `data-src` вместо `src` (без `src` новые медиа не добавлять: загрузит только код из `scripts.js`, блок «Media loading»).
1. **Критичное** (грузится во время лоадера, параллельно) — `<link rel="preload">` в `<head>`: Aeonik Pro Regular + Medium, `hero2_compressed.jpg`; плюс `data-load="critical"`: `LH_arch.webm`, 1-й слайд «Концепції» (`Location.webm`), 1-я карточка клабхауса (SPA), 1-е видео галереи вилл (`terrace.webm`), `build1.mp4`, обложки 5 сторис вилл (картинки ещё и `decode()`). Видео — до `canplaythrough`. `window.criticalReady` + `window.loadProgress()` (0..1), общий лимит `CRITICAL_MAX` = 15с.
2. **Очередь** — `data-load="queue"`, по одному в порядке страницы после `criticalReady`: первый слайд остальных `.gallery` / `.carousel`, `build2`. Следующий файл — после `canplaythrough`/`load` (или 10с).
3. **Остальное** — слайды `.gallery`/`.carousel` целиком, когда блок в ~1 экране (`rootMargin: 100%`); `.stories` сами грузят текущий + следующий слайд (с `preload='auto'`), когда рядом; плюс когда первая вилла в ~1 экране, все слайды всех вилл грузятся фоном по одному по порядку. Клик по вкладке галереи подгружает её сразу.
- Inter (Google Fonts) удалён — не использовался. PP Hatton не в preload (только лого).

## Система анимаций (`data-anim`)
- `hero-title`, `hero-fade`, `hero-header` — анимирует `intro()`
- `lines` — заголовки; обычный fade-up, как `fade`
- `scrub` — абзац «заливается» по словам при скролле
- `fade` / `fade-only` — появление с подъёмом / без
- `stagger` — дети контейнера по очереди
- `count` — цифры в `.lot_main` / `.lot_terrace` считаются от 0
- Скрытие до старта GSAP через `html.js-anim`; инлайн-скрипт ставит `js-anim` и `is-loading` вместе, только если нет reduced-motion.
- `footerReveal()` — scrub: футер расширяется (`--inset` 2.5vw→0.5vw, мобилка 12px→0) и съезжает вниз, открывая `.outro`. CSS по умолчанию = конечное состояние.
- `setupSnap()` — пошаговый скролл по `.types .stories`, только desktop с мышью и Lenis.

## Конвенции
- Классы BEM-подобные через подчёркивание: `block_element` (`gallery_tab`, `stories_seg`), состояния `active`, `done`, `is-open`, `is-visible`.
- JS — ES5-стиль (`var`, `function`, IIFE), без модулей и зависимостей кроме CDN.
- Комментарии короткие, на английском.
- Кнопки-CTA: класс `.btn-soft` + свой класс для цвета/позиции. Цвет фона — через `--btn-bg`. Hover: `scale: 0.95` (свойство `scale`, не `transform`). Углы — `corner-shape: superellipse(1.5)`, без поддержки радиус ×0.752.
- Мобилка: breakpoint 767px и в CSS, и в JS (`isMobile`). На мобилке `.drawer` скрыт, кнопка «Меню» в hero открывает плавающую пилюлю (своё мобильное меню — TODO).

## Известные нюансы / TODO
- Заглушки `href="#"`: брошюра, PDF, планировки виллы, WhatsApp, соцсети, политики, «Запис на перегляд». Форма футера никуда не отправляет.
- Ответы FAQ — один и тот же текст-заглушка из макета.
- Телефон: в шапке/футере `+380 (63) 226 30 62`, в раскрытой пилюле-меню ещё старый `+380657865567` из макета.
- Лоты: 4 карточки с планировками `media/floorplans/penthouse/webp/floorplan-1…4.webp`; площади/спальни — заглушки.
