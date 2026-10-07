import { connect } from "cloudflare:sockets";

const STREAMS = [
  { hostname: "stream1.jungletrain.net", port: 8000 },
  { hostname: "stream5.jungletrain.net", port: 8000 },
  { hostname: "stream3.jungletrain.net", port: 8000 },
];

const STREAM_INFO_SOURCE = "https://jungletrain.net/api/v1/stream/info/";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_LIMIT_BYTES = 8192;
const HEADER_TIMEOUT_MS = 7000;
const NOW_PLAYING_TIMEOUT_MS = 8000;
const NOW_PLAYING_READ_LIMIT_BYTES = 524288;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

const radioHeaders = {
  ...corsHeaders,
  "Accept-Ranges": "none",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Content-Type": "audio/mpeg",
  "Expires": "0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

const nowPlayingHeaders = {
  ...corsHeaders,
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Content-Type": "application/json; charset=utf-8",
  "Expires": "0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    if (pathname === "/now-playing") {
      return handleNowPlaying(request);
    }

    if (pathname !== "/radio") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "HEAD") {
      return new Response(null, { headers: radioHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, OPTIONS" },
      });
    }

    const { readable, writable } = new TransformStream();
    relayRadio(writable, request.signal).catch(() => {});

    return new Response(readable, { headers: radioHeaders });
  },
};

async function handleNowPlaying(request) {
  if (request.method === "HEAD") {
    return new Response(null, { headers: nowPlayingHeaders });
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        ...corsHeaders,
        Allow: "GET, HEAD, OPTIONS",
      },
    });
  }

  try {
    const { nowplaying, listeners } = await getNowPlaying(request.signal);
    const { artist, track } = splitNowPlaying(nowplaying);

    return jsonResponse({
      nowplaying,
      artist,
      track,
      listeners,
      source: "jungletrain.net",
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({
      nowplaying: "",
      artist: "",
      track: "",
      listeners: null,
      source: "jungletrain.net",
      error: "unavailable",
      updatedAt: new Date().toISOString(),
    }, 502);
  }
}

async function getNowPlaying(signal) {
  let lastError;

  try {
    const streamInfo = await fetchNowPlayingFromApi();

    if (streamInfo.nowplaying) {
      return streamInfo;
    }

    lastError = new Error("jungletrain stream info returned an empty title");
  } catch (error) {
    lastError = error;
  }

  for (const stream of STREAMS) {
    if (signal.aborted) throw new Error("Client disconnected");

    try {
      const nowplaying = await readIcyNowPlaying(stream, signal);

      if (nowplaying) {
        return {
          nowplaying,
          listeners: null,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("jungletrain now playing is unavailable");
}

async function fetchNowPlayingFromApi() {
  const streamInfoUrl = new URL(STREAM_INFO_SOURCE);
  streamInfoUrl.searchParams.set("_", Date.now().toString());

  const response = await fetch(streamInfoUrl.toString(), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`jungletrain stream info returned ${response.status}`);
  }

  const stats = await response.json();
  const listeners = Number(stats.listeners);

  return {
    nowplaying: normalizeNowPlaying(stats.title ?? stats.nowplaying),
    listeners: Number.isFinite(listeners) ? listeners : null,
  };
}

async function readIcyNowPlaying(stream, signal) {
  const socket = connect({ hostname: stream.hostname, port: stream.port });
  const closeSocket = () => socket.close();
  const headerTimeout = setTimeout(closeSocket, NOW_PLAYING_TIMEOUT_MS);
  let reader;
  let bytesRead = 0;
  let headerParsed = false;
  let metaInterval = 0;
  let buffer = new Uint8Array(0);

  signal.addEventListener("abort", closeSocket, { once: true });

  try {
    const socketWriter = socket.writable.getWriter();
    await socketWriter.write(encoder.encode(buildRequest(stream, true)));
    socketWriter.releaseLock();

    reader = socket.readable.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      bytesRead += value.length;
      if (bytesRead > NOW_PLAYING_READ_LIMIT_BYTES) {
        throw new Error(`No ICY metadata from ${stream.hostname}`);
      }

      buffer = concatBytes(buffer, value);

      if (!headerParsed) {
        const headerEnd = findHeaderEnd(buffer);

        if (headerEnd === -1) {
          if (buffer.length > HEADER_LIMIT_BYTES) {
            throw new Error(`No ICY headers from ${stream.hostname}`);
          }

          continue;
        }

        const headers = decoder.decode(buffer.slice(0, headerEnd));
        metaInterval = getIcyMetaInterval(headers);
        if (!metaInterval) {
          throw new Error(`No icy-metaint from ${stream.hostname}`);
        }

        buffer = buffer.slice(headerEnd + 4);
        headerParsed = true;
      }

      const streamTitle = readStreamTitleFromMetadata(buffer, metaInterval);
      if (streamTitle) return streamTitle;
    }

    throw new Error(`No StreamTitle from ${stream.hostname}`);
  } finally {
    clearTimeout(headerTimeout);
    signal.removeEventListener("abort", closeSocket);
    if (reader) reader.releaseLock();
    socket.close();
  }
}

async function relayRadio(writable, signal) {
  const writer = writable.getWriter();

  try {
    let lastError;

    for (const stream of STREAMS) {
      if (signal.aborted) throw new Error("Client disconnected");

      try {
        await pipeStream(stream, writer, signal);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("No jungletrain streams are available");
  } catch (error) {
    await writer.abort(error);
  }
}

async function pipeStream(stream, writer, signal) {
  const socket = connect({ hostname: stream.hostname, port: stream.port });
  const closeSocket = () => socket.close();
  const headerTimeout = setTimeout(closeSocket, HEADER_TIMEOUT_MS);
  let bodyStarted = false;

  signal.addEventListener("abort", closeSocket, { once: true });

  try {
    const socketWriter = socket.writable.getWriter();
    await socketWriter.write(encoder.encode(buildRequest(stream)));
    socketWriter.releaseLock();

    const reader = socket.readable.getReader();
    let headerBuffer = new Uint8Array(0);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      if (bodyStarted) {
        await writer.write(value);
        continue;
      }

      headerBuffer = concatBytes(headerBuffer, value);
      const headerEnd = findHeaderEnd(headerBuffer);

      if (headerEnd !== -1) {
        bodyStarted = true;
        clearTimeout(headerTimeout);

        const body = headerBuffer.slice(headerEnd + 4);
        if (body.length > 0) {
          await writer.write(body);
        }
        continue;
      }

      if (headerBuffer.length > HEADER_LIMIT_BYTES) {
        bodyStarted = true;
        clearTimeout(headerTimeout);
        await writer.write(headerBuffer);
      }
    }

    if (!bodyStarted) {
      throw new Error(`No audio body from ${stream.hostname}`);
    }

    await writer.close();
  } finally {
    clearTimeout(headerTimeout);
    signal.removeEventListener("abort", closeSocket);
    socket.close();
  }
}

function buildRequest(stream, includeMetadata = false) {
  return [
    "GET / HTTP/1.0",
    `Host: ${stream.hostname}:${stream.port}`,
    "User-Agent: svarganil-radio-relay/1.0",
    "Accept: audio/mpeg,*/*",
    `Icy-MetaData: ${includeMetadata ? 1 : 0}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
}

function concatBytes(left, right) {
  const bytes = new Uint8Array(left.length + right.length);
  bytes.set(left, 0);
  bytes.set(right, left.length);
  return bytes;
}

function findHeaderEnd(bytes) {
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (
      bytes[index] === 13 &&
      bytes[index + 1] === 10 &&
      bytes[index + 2] === 13 &&
      bytes[index + 3] === 10
    ) {
      return index;
    }
  }

  return -1;
}

function getIcyMetaInterval(headers) {
  const match = headers.match(/(?:^|\r?\n)icy-metaint:\s*(\d+)/i);
  if (!match) return 0;

  const metaInterval = Number(match[1]);
  return Number.isFinite(metaInterval) ? metaInterval : 0;
}

function readStreamTitleFromMetadata(bytes, metaInterval) {
  let offset = 0;

  while (bytes.length >= offset + metaInterval + 1) {
    const metadataLength = bytes[offset + metaInterval] * 16;
    const metadataStart = offset + metaInterval + 1;
    const metadataEnd = metadataStart + metadataLength;

    if (bytes.length < metadataEnd) return "";

    const metadata = decoder.decode(bytes.slice(metadataStart, metadataEnd)).replace(/\0+$/g, "");
    const streamTitle = getStreamTitle(metadata);

    if (streamTitle) return streamTitle;

    offset = metadataEnd;
  }

  return "";
}

function getStreamTitle(metadata) {
  const match = metadata.match(/StreamTitle='([^']*)'/i);
  return match ? normalizeNowPlaying(match[1]) : "";
}

function normalizeNowPlaying(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function splitNowPlaying(nowplaying) {
  const separator = " - ";
  const separatorIndex = nowplaying.indexOf(separator);

  if (separatorIndex === -1) {
    return {
      artist: "",
      track: nowplaying,
    };
  }

  return {
    artist: nowplaying.slice(0, separatorIndex).trim(),
    track: nowplaying.slice(separatorIndex + separator.length).trim(),
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: nowPlayingHeaders,
  });
}
