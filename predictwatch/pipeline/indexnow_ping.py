"""Tell Bing (and other IndexNow engines) which Sirtio URLs to crawl.

Reads the live sitemap and submits every URL in one IndexNow request.
Uses only the standard library, so the workflow needs no pip install.
The key file served at https://www.sirtio.com/<KEY>.txt proves ownership.
"""
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET

HOST = "www.sirtio.com"
KEY = "2fe5360318594680aef1076b1f1050db"
SITEMAP_URL = f"https://{HOST}/sitemap.xml"
ENDPOINT = "https://api.indexnow.org/indexnow"
NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def fetch_sitemap_urls() -> list[str]:
    with urllib.request.urlopen(SITEMAP_URL, timeout=30) as resp:
        root = ET.fromstring(resp.read())
    return [e.text.strip() for e in root.findall("sm:url/sm:loc", NS) if e.text]


def main() -> int:
    urls = fetch_sitemap_urls()
    if not urls:
        print("Sitemap has no URLs; nothing to submit.")
        return 1
    payload = {
        "host": HOST,
        "key": KEY,
        "keyLocation": f"https://{HOST}/{KEY}.txt",
        "urlList": urls[:10000],
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"IndexNow accepted {len(payload['urlList'])} URLs (HTTP {resp.status})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
