#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


STREAMS = (
    ("stream1.jungletrain.net", 8000),
    ("stream5.jungletrain.net", 8000),
    ("stream3.jungletrain.net", 8000),
)

HEADER_LIMIT_BYTES = 8192
READ_SIZE_BYTES = 16384


class RadioRequestHandler(SimpleHTTPRequestHandler):
    def do_HEAD(self) -> None:
        if self.path.rstrip("/") == "/radio":
            self.send_radio_headers()
            return

        super().do_HEAD()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/radio":
            self.proxy_radio()
            return

        super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_radio_headers(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Accept-Ranges", "none")
        self.end_headers()

    def proxy_radio(self) -> None:
        last_error: Exception | None = None

        for host, port in STREAMS:
            stream = None
            try:
                stream = socket.create_connection((host, port), timeout=7)
                stream.settimeout(10)
                stream.sendall(build_stream_request(host, port))
                header, body = read_stream_header(stream)

                if not header.startswith(b"ICY ") and b"content-type:" not in header.lower():
                    raise RuntimeError(f"unexpected stream response from {host}")

                self.send_radio_headers()
                if body:
                    self.wfile.write(body)

                while True:
                    chunk = stream.recv(READ_SIZE_BYTES)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

                return
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                last_error = error
            finally:
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass

        self.send_error(502, f"Radio stream unavailable: {last_error}")


def build_stream_request(host: str, port: int) -> bytes:
    request = "\r\n".join(
        (
            "GET / HTTP/1.0",
            f"Host: {host}:{port}",
            "User-Agent: svarganil-local-radio/1.0",
            "Accept: audio/mpeg,*/*",
            "Icy-MetaData: 0",
            "Connection: close",
            "",
            "",
        )
    )
    return request.encode("ascii")


def read_stream_header(stream: socket.socket) -> tuple[bytes, bytes]:
    data = b""

    while b"\r\n\r\n" not in data and len(data) < HEADER_LIMIT_BYTES:
        chunk = stream.recv(READ_SIZE_BYTES)
        if not chunk:
            break
        data += chunk

    header_end = data.find(b"\r\n\r\n")
    if header_end == -1:
        return b"", data

    return data[:header_end], data[header_end + 4 :]


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the site with a Safari-compatible /radio relay.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)

    server = ThreadingHTTPServer((args.host, args.port), RadioRequestHandler)
    print(f"Serving {root}")
    print(f"Open http://{args.host}:{args.port}/ in Safari")
    print(f"Radio relay: http://{args.host}:{args.port}/radio")
    server.serve_forever()


if __name__ == "__main__":
    main()
