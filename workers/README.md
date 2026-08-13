# Jungletrain radio relay

Safari не принимает jungletrain напрямую, потому что поток отвечает legacy-заголовком
`ICY 200 OK`, а не нормальным `HTTP/1.1 200 OK`.

## Локальная проверка в Safari

Если открыть `index.html` напрямую как `file://...`, серверный relay не запустится сам.
Для проверки Safari локально запусти из корня проекта:

```sh
python3 tools/local-radio-server.py
```

И открой в Safari:

```txt
http://127.0.0.1:8000/
```

Если всё же открыть `index.html` как файл, код будет пробовать
`http://127.0.0.1:8000/radio`, но для этого локальный сервер всё равно должен
быть запущен.

Проверка endpoint:

```sh
curl -I http://127.0.0.1:8000/radio
```

Ожидаемый `Content-Type`:

```txt
audio/mpeg
```

## Продакшн

Сейчас `https://svarganil.ru/radio` отдаёт GitHub Pages `404`. Это значит, что
relay ещё не подключён к живому домену.

### Вариант 1: Cloudflare route на основном домене

Подходит, если `svarganil.ru` обслуживается через Cloudflare DNS.

1. В `workers/wrangler.toml` раскомментируй блок `routes`.
2. Задеплой Worker из этой папки:

```sh
cd workers
wrangler deploy
```

3. Проверь endpoint:

```sh
curl -I https://svarganil.ru/radio
```

Ожидаемый `Content-Type`:

```txt
audio/mpeg
```

После этого `index.html` уже готов: Safari/iOS/iPadOS сначала пробуют `/radio`.

### Вариант 2: workers.dev без переноса DNS в Cloudflare

Если основной домен остаётся на GitHub Pages без Cloudflare route:

1. Задеплой Worker:

```sh
cd workers
wrangler deploy
```

2. Cloudflare выдаст URL вида:

```txt
https://svarganil-radio.<account>.workers.dev
```

3. В `index.html` замени:

```js
const RADIO_RELAY_SOURCE = "/radio";
```

на:

```js
const RADIO_RELAY_SOURCE = "https://svarganil-radio.<account>.workers.dev/radio";
```
