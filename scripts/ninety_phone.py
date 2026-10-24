#!/usr/bin/env python3
"""Experimental Ninety device setup for Python 3 in a-Shell.

Protocol and Samsung certificate flow checked against Apps2Samsung and
PatrickSt1991/tizen-sdb (MIT). Never uploads credentials to Ninety or GitHub.
This version only reads TV information and provisions a separate test identity.
"""
import argparse
import base64
import datetime
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_FRAME = 1048576
STATE_DIR = Path.home() / "Documents" / "ninety-phone-private"


class SDB:
    def __init__(self, ip):
        self.sock = socket.create_connection((ip, 26101), 15)
        self.local = 0
        try:
            self.send("CNXN", 0x100000, 262144, b"host::\0")
            cmd, _, self.max_data, banner = self.receive()
            if cmd != "CNXN":
                raise RuntimeError("TV refused SDB handshake: " + cmd)
            self.max_data = min(self.max_data or 4096, 65536)
            self.banner = banner.decode(errors="replace").rstrip("\0")
        except BaseException:
            self.sock.close()
            raise

    def close(self):
        self.sock.close()

    def read(self, n):
        result = bytearray()
        while len(result) < n:
            block = self.sock.recv(n - len(result))
            if not block:
                raise RuntimeError("TV closed SDB connection")
            result.extend(block)
        return bytes(result)

    def send(self, command, a, b, payload=b""):
        command = int.from_bytes(command.encode("ascii"), "little")
        header = struct.pack("<6I", command, a, b, len(payload),
                             sum(payload) & 0xffffffff, command ^ 0xffffffff)
        self.sock.sendall(header + payload)

    def receive(self):
        c, a, b, n, check, magic = struct.unpack("<6I", self.read(24))
        if magic != c ^ 0xffffffff or n > MAX_FRAME:
            raise RuntimeError("Invalid SDB frame header")
        data = self.read(n)
        if sum(data) & 0xffffffff != check:
            raise RuntimeError("Invalid SDB payload checksum")
        return c.to_bytes(4, "little").decode("ascii"), a, b, data

    def service(self, name):
        self.local += 1
        local = self.local
        self.send("OPEN", local, 0, name.encode() + b"\0")
        output = bytearray()
        accepted = False
        for _ in range(2048):
            c, a, b, data = self.receive()
            if b != local:
                raise RuntimeError("Unexpected SDB stream ID")
            if c == "OKAY":
                accepted = True
            elif c == "WRTE":
                accepted = True
                output.extend(data)
                if len(output) > MAX_FRAME:
                    raise RuntimeError("TV reply exceeds size limit")
                self.send("OKAY", local, a)
            elif c == "CLSE":
                self.send("CLSE", local, a)
                if not accepted:
                    raise RuntimeError("TV refused service: " + name)
                return bytes(output)
            else:
                raise RuntimeError("Unexpected SDB command: " + c)
        raise RuntimeError("Too many SDB frames")

    def capabilities(self):
        raw = self.service("capability:")
        if len(raw) < 2:
            raise RuntimeError("Truncated capabilities")
        length = struct.unpack("<H", raw[:2])[0]
        if length > len(raw) - 2:
            raise RuntimeError("Truncated capabilities payload")
        text = raw[2:2 + length].decode(errors="replace").rstrip("\0")
        return dict(line.split(":", 1) for line in text.splitlines() if ":" in line)


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    with os.fdopen(os.open(path, flags, 0o600), "wb") as handle:
        handle.write(data)
    os.chmod(path, 0o600)


def probe(ip):
    device = SDB(ip)
    try:
        caps = device.capabilities()
        print("TV:", device.banner)
        print("Tizen:", caps.get("platform_version", "unknown"))
        duid = device.service("shell:0 getduid").decode(errors="replace").strip("\0\r\n ")
        # The Samsung dispatcher normally returns the bare DUID. Never guess from
        # the TVkey ID or serial number: those are different identifiers.
        # Retail TVs can return a short identifier (observed on Q70T/5.5).
        # Validate the token's shape, without assuming a UUID/hash length.
        if not duid or len(duid) > 256 or not duid.isascii() or not all(c.isalnum() or c in "-_" for c in duid):
            raise RuntimeError("Unexpected DUID response; stop and report this result: " + repr(duid))
        print("DUID read OK (not printed)")
        info = {"ip": ip, "duid": duid, "capabilities": caps}
        private_write(STATE_DIR / "device.json", json.dumps(info).encode())
        return info
    finally:
        device.close()


def capture_login():
    # Accept only a loopback POST with a fresh matching state. Tokens remain
    # in memory and are sent only to Samsung's certificate service.
    expected_state = secrets.token_urlsafe(32)
    token = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status, text):
            data = text.encode()
            self.send_response(status)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.respond(200, "Ninety certificate callback is running. Sign in to Samsung, then return to a-Shell.")

        def do_POST(self):
            if self.path != "/signin/callback":
                self.respond(404, "Not found")
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size < 131072:
                    raise ValueError("Invalid callback length")
                fields = urllib.parse.parse_qs(self.rfile.read(size).decode())
                if fields.get("state", [None])[0] != expected_state:
                    raise ValueError("Invalid callback state")
                code = fields.get("code", [""])[0]
                # Some Samsung versions double-encode the JSON field.
                if not code.lstrip().startswith("{"):
                    code = urllib.parse.unquote(code)
                value = json.loads(code)
                if not all(value.get(k) for k in ("access_token", "userId", "inputEmailID")):
                    raise ValueError("Incomplete Samsung account response")
                token.update(value)
            except (ValueError, KeyError, UnicodeError):
                self.respond(400, "Invalid Samsung callback. Retry sign-in.")
                return
            self.respond(200, "Samsung sign-in received. Return to a-Shell to continue. Do not share this page's URL or account tokens.")

    class LoopbackServer(http.server.HTTPServer):
        address_family = socket.AF_INET6

        def server_bind(self):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            super().server_bind()

    # Dual-stack localhost is required: Safari can resolve localhost to ::1.
    # Bind :: with a peer check: the callback itself must remain loopback-only.
    class LocalServer(LoopbackServer):
        def verify_request(self, request, client_address):
            import ipaddress
            address = ipaddress.ip_address(client_address[0])
            return address.is_loopback or bool(getattr(address, "ipv4_mapped", None) and address.ipv4_mapped.is_loopback)

    query = urllib.parse.urlencode({"locale": "", "clientId": "v285zxnl3h",
        "redirect_uri": "http://localhost:4794/signin/callback", "state": expected_state, "tokenType": "TOKEN"})
    url = "https://account.samsung.com/accounts/be1dce529476c1a6d407c4c7578c31bd/signInGate?" + query
    with LocalServer(("::", 4794), Callback) as server:
        server.timeout = 1
        print("\nOpen this Samsung login address on THIS iPhone:", flush=True)
        print(url, flush=True)
        print("Keep a-Shell running. Return here after sign-in. Waiting up to 10 minutes.", flush=True)
        # a-Shell provides an internal browser through Python's webbrowser
        # integration on some versions. A failed launch leaves the printed URL.
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass
        deadline = time.monotonic() + 600
        while not token and time.monotonic() < deadline:
            server.handle_request()
    if not token:
        raise RuntimeError("No callback received. No certificate was requested. Browser restrictions or iOS background suspension may block this step.")
    return token


def multipart_post(url, fields, csr):
    boundary = "ninety-" + secrets.token_hex(16)
    pieces = []
    for name, value in fields.items():
        pieces.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").encode() + value.encode() + b"\r\n")
    pieces.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"csr\"; filename=\"request.csr\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + csr + b"\r\n")
    pieces.append(("--" + boundary + "--\r\n").encode())
    request = urllib.request.Request(url, b"".join(pieces),
        {"Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read(1048576)
    except urllib.error.HTTPError as error:
        # Request bodies contain credentials; never echo them or raw server errors.
        raise RuntimeError("Samsung certificate API returned HTTP " + str(error.code)) from None


def provision(info):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    cert_dir = STATE_DIR / "certificates"
    if (cert_dir / "author.pem").exists():
        raise RuntimeError("A test identity already exists. Refusing to replace its author key.")
    auth = capture_login()
    print("Samsung sign-in received; generating a separate TEST key.", flush=True)
    key_path = cert_dir / "test-key.pem"
    if key_path.exists():
        key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    else:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_write(key_path, key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    author_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Ninety Phone Test")])
    author_csr = x509.CertificateSigningRequestBuilder().subject_name(author_name).sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM)
    dist_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "TizenSDK"),
        x509.NameAttribute(NameOID.EMAIL_ADDRESS, auth["inputEmailID"])])
    san = x509.SubjectAlternativeName([x509.UniformResourceIdentifier("URN:tizen:packageid="),
        x509.UniformResourceIdentifier("URN:tizen:deviceid=" + info["duid"])])
    dist_csr = x509.CertificateSigningRequestBuilder().subject_name(dist_name).add_extension(san, False).sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM)
    fields = {"access_token": auth["access_token"], "user_id": auth["userId"], "platform": "VD"}
    root = "https://svdca.samsungqbe.com/apis/"
    author = multipart_post(root + "v3/authors", fields, author_csr)
    fields.update(privilege_level="public", developer_type="Individual")
    profile = multipart_post(root + "v1/distributors", fields, dist_csr)
    distributor = multipart_post(root + "v3/distributors", fields, dist_csr)
    def parse_cert(data):
        try:
            return x509.load_pem_x509_certificate(data)
        except ValueError:
            return x509.load_der_x509_certificate(data)
    author_cert, distributor_cert = parse_cert(author), parse_cert(distributor)
    public = key.public_key().public_numbers()
    for cert in (author_cert, distributor_cert):
        if cert.public_key().public_numbers() != public:
            raise RuntimeError("Samsung returned a certificate for another key")
    identifiers = distributor_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.UniformResourceIdentifier)
    if "URN:tizen:deviceid=" + info["duid"] not in identifiers:
        raise RuntimeError("Distributor certificate does not cover this TV")
    private_write(cert_dir / "author.pem", author_cert.public_bytes(serialization.Encoding.PEM))
    private_write(cert_dir / "distributor.pem", distributor_cert.public_bytes(serialization.Encoding.PEM))
    private_write(cert_dir / "device-profile.xml", profile)
    print("TEST certificates issued and saved privately on this iPhone.")
    print("No app has been installed. Keep this folder; do not share its private key.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["probe", "setup"])
    parser.add_argument("--ip", default="192.168.10.231")
    args = parser.parse_args()
    info = probe(args.ip)
    if args.action == "setup":
        provision(info)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as error:
        print("STOP:", str(error))
        raise SystemExit(1)
