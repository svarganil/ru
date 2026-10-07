import { connect } from "cloudflare:sockets";

const STREAMS = [
  { hostname: "stream1.jungletrain.net", port: 8000 },
  { hostname: "stream5.jungletrain.net", port: 8000 },
  { hostname: "stream3.jungletrain.net", port: 8000 },
];

const STREAM_INFO_SOURCE = "https://jungletrain.net/api/v1/stream/info/";
const encoder = new TextEncoder();
const HEADER_LIMIT_BYTES = 8192;
const HEADER_TIMEOUT_MS = 7000;

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
    const streamInfoUrl = new URL(STREAM_INFO_SOURCE);
    streamInfoUrl.searchParams.set("_", Date.now().toString());

    const response = await fetch(streamInfoUrl.toString(), {
      cache: "no-store",
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      throw new Error(`jungletrain stream info returned ${response.status}`);
    }

    const stats = await response.json();
    const nowplaying = normalizeNowPlaying(stats.title ?? stats.nowplaying);
    const { artist, track } = splitNowPlaying(nowplaying);
    const listeners = Number(stats.listeners);

    return jsonResponse({
      nowplaying,
      artist,
      track,
      listeners: Number.isFinite(listeners) ? listeners : null,
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

function buildRequest(stream) {
  return [
    "GET / HTTP/1.0",
    `Host: ${stream.hostname}:${stream.port}`,
    "User-Agent: svarganil-radio-relay/1.0",
    "Accept: audio/mpeg,*/*",
    "Icy-MetaData: 0",
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
