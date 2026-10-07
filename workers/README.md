# Jungletrain radio relay

Safari не принимает jungletrain напрямую, потому что поток отвечает legacy-заголовком
`ICY 200 OK`, а не нормальным `HTTP/1.1 200 OK`.

## Локальная проверка в Safari

Если открыть `index.html` напрямую как `file://...`, радио будет идти через
Cloudflare Worker:

```txt
https://svarganil-radio.svarganil.workers.dev/radio
```

Если нужно проверить именно локальный relay, запусти из корня проекта:

```sh
python3 tools/local-radio-server.py
```

И открой в Safari:

```txt
http://127.0.0.1:8000/
```

Проверка endpoint:

```sh
curl -I http://127.0.0.1:8000/radio
curl http://127.0.0.1:8000/now-playing
```

Ожидаемые `Content-Type`:

```txt
/radio: audio/mpeg
/now-playing: application/json; charset=utf-8
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
npx wrangler deploy
```

3. Проверь endpoint:

```sh
curl -I https://svarganil.ru/radio
curl https://svarganil.ru/now-playing
```

Ожидаемые `Content-Type`:

```txt
/radio: audio/mpeg
/now-playing: application/json; charset=utf-8
```

После этого `index.html` можно перевести на `/radio` и `/now-playing` на основном
домене вместо `workers.dev`.

### Вариант 2: workers.dev без переноса DNS в Cloudflare

Если основной домен остаётся на GitHub Pages без Cloudflare route:

Worker уже задеплоен:

```txt
https://svarganil-radio.svarganil.workers.dev/radio
```

Этот URL уже подключён в `index.html`:

```js
const WORKER_RADIO_RELAY_SOURCE = "https://svarganil-radio.svarganil.workers.dev/radio";
const WORKER_NOW_PLAYING_SOURCE = "https://svarganil-radio.svarganil.workers.dev/now-playing";
```

Текущий трек берётся из публичного `https://jungletrain.net/api/v1/stream/info/`.
Если этот API недоступен из Cloudflare Worker, Worker читает `StreamTitle` из
ICY-метаданных радиопотока. Сайту данные отдаются через `/now-playing`, чтобы
не зависеть от CORS.
