#!/usr/bin/env python3
"""Simple bridge that accepts wind speed posts and forwards them to a serial port."""

import json
import logging
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

try:
    import serial  # type: ignore
except ImportError as exc:
    raise SystemExit(
        "pyserial is required for serial_bridge.py. Install it with 'pip install pyserial'."
    ) from exc

SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
BRIDGE_HOST = os.getenv("BRIDGE_HOST", "0.0.0.0")
BRIDGE_PORT = int(os.getenv("BRIDGE_PORT", "5000"))

logger = logging.getLogger("serial_bridge")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


class WindSpeedHandler(BaseHTTPRequestHandler):
    serial_conn: Optional[serial.Serial] = None

    def _set_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/wind-speed":
            self.send_response(404)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"not_found"}')
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = self.rfile.read(length) if length else b"{}"
            data = json.loads(payload)
            wind_speed = float(data["windSpeedKmh"])
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            self.send_response(400)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"invalid_payload"}')
            return

        message = f"{wind_speed:.1f}\n".encode("utf-8")

        try:
            assert self.serial_conn is not None
            self.serial_conn.write(message)
        except (AssertionError, serial.SerialException) as error:
            logger.exception("Serial write failed")
            self.send_response(500)
            self._set_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            payload = json.dumps({"error": "serial_error", "details": str(error)}).encode("utf-8")
            self.wfile.write(payload)
            return

        self.send_response(200)
        self._set_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003 - BaseHTTPRequestHandler API
        logger.info("%s - %s", self.address_string(), format % args)


def create_server(serial_conn: serial.Serial) -> ThreadingHTTPServer:
    handler_cls = WindSpeedHandler
    handler_cls.serial_conn = serial_conn
    server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), handler_cls)
    logger.info("Listening on http://%s:%s", BRIDGE_HOST or "127.0.0.1", BRIDGE_PORT)
    return server


def main() -> None:
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    except serial.SerialException as exc:
        logger.error("Unable to open serial port %s: %s", SERIAL_PORT, exc)
        raise SystemExit(1) from exc

    logger.info("Opened serial port %s at %s baud", SERIAL_PORT, BAUD_RATE)

    server = create_server(ser)

    def shutdown_handler(signum: int, frame: Optional[object]) -> None:  # noqa: ARG001 - signature required
        logger.info("Received signal %s, shutting down", signum)
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)

    try:
        server.serve_forever()
    finally:
        ser.close()
        logger.info("Serial port closed")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
