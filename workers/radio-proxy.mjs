import { connect } from "cloudflare:sockets";

const STREAMS = [
  { hostname: "stream1.jungletrain.net", port: 8000 },
  { hostname: "stream5.jungletrain.net", port: 8000 },
  { hostname: "stream3.jungletrain.net", port: 8000 },
];

const encoder = new TextEncoder();
const HEADER_LIMIT_BYTES = 8192;
const HEADER_TIMEOUT_MS = 7000;

const radioHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Accept-Ranges": "none",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Content-Type": "audio/mpeg",
  "Expires": "0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        },
      });
    }

    if (url.pathname !== "/radio" && url.pathname !== "/radio/") {
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
