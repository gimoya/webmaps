# Portrait-phone capture. Same sequence as capture_cleanup_gif.py.
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(r"c:\GitHub\webmaps\track_toolbox")
KML = ROOT / "samples" / "BOLOGNA_Track_Samples.kml"
FRAMES = ROOT / "samples" / "_gif_work" / "frames_mobile"
GIF = ROOT / "samples" / "bologna-cleanup-mobile.gif"
URL = "http://127.0.0.1:8779/"
VIEW = {"width": 390, "height": 844}

# After trimming Nadine (~22%–78%), digitize along the remaining line (mid nudged east).
TRIM_BEFORE = (44.35818, 11.19353)
TRIM_AFTER = (44.3745905, 11.1897552)
STATIONS = [
    (44.35818, 11.19353),
    (44.36932, 11.16690),
    (44.3745905, 11.1897552),
]
KEEPERS = ("Bernhard", "Vroni", "Nadine")
ROUTE_NAME = "Nadine_new"

INIT = r"""
Object.defineProperty(window, "L", {
  configurable: true,
  enumerable: true,
  get() { return window.__L; },
  set(v) {
    window.__L = v;
    if (v && v.Map && v.Map.addInitHook) {
      v.Map.addInitHook(function () { window.__ttMap = this; });
    }
  }
});
"""

CURSOR = r"""
(() => {
  const c = document.createElement("div");
  c.id = "__demo-cursor";
  c.style.cssText = [
    "position:fixed", "width:18px", "height:18px", "border-radius:50%",
    "border:2px solid #fff", "background:#00b9fe", "z-index:2147483647",
    "pointer-events:none", "transform:translate(-50%,-50%)",
    "box-shadow:0 0 0 1px #000, 0 2px 6px rgba(0,0,0,.45)",
    "left:50%", "top:50%"
  ].join(";");
  document.body.appendChild(c);
  window.__cursor = { x: 195, y: 422 };
  window.__moveCursor = (x, y) => {
    window.__cursor = { x, y };
    c.style.left = x + "px";
    c.style.top = y + "px";
  };
})();
"""

n = 0


def shot(page, copies: int = 1) -> None:
    global n
    FRAMES.mkdir(parents=True, exist_ok=True)
    src = FRAMES / f"{n:04d}.png"
    page.screenshot(path=str(src), type="png")
    n += 1
    for _ in range(copies - 1):
        shutil.copyfile(src, FRAMES / f"{n:04d}.png")
        n += 1


def wait_shot(page, ms: int, step: int = 140) -> None:
    elapsed = 0
    while elapsed < ms:
        shot(page)
        page.wait_for_timeout(step)
        elapsed += step


def cursor_to(page, x: float, y: float, steps: int = 7) -> None:
    cur = page.evaluate("() => window.__cursor")
    x0, y0 = float(cur["x"]), float(cur["y"])
    for i in range(1, steps + 1):
        nx = x0 + (x - x0) * i / steps
        ny = y0 + (y - y0) * i / steps
        page.evaluate("([x,y]) => window.__moveCursor(x,y)", [nx, ny])
        shot(page)
        page.wait_for_timeout(30)


def click_xy(page, x: float, y: float) -> None:
    cursor_to(page, x, y)
    page.mouse.click(x, y)
    page.evaluate(
        """() => {
          const c = document.getElementById("__demo-cursor");
          c.style.transform = "translate(-50%,-50%) scale(0.75)";
          setTimeout(() => { c.style.transform = "translate(-50%,-50%) scale(1)"; }, 120);
        }"""
    )
    shot(page, 2)


def el_center(page, selector: str) -> tuple[float, float]:
    box = page.locator(selector).bounding_box()
    if not box:
        raise RuntimeError("missing " + selector)
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def click_sel(page, selector: str) -> None:
    page.locator(selector).scroll_into_view_if_needed()
    x, y = el_center(page, selector)
    click_xy(page, x, y)


def rs_status(page) -> dict:
    return page.evaluate(
        """() => {
          const map = window.__ttMap;
          const clicks = map && map._events && map._events.click;
          let nwp = 0;
          if (clicks) {
            for (const id of Object.keys(clicks)) {
              const ctx = clicks[id].ctx;
              if (ctx && ctx._waypoints) nwp = ctx._waypoints.length;
            }
          }
          const s = document.querySelector(".legacy-routesnap-status");
          const btn = document.querySelector('button[title="Add to tracks"]');
          return {
            nwp,
            status: s ? s.textContent : "",
            save: btn ? !btn.disabled : false,
            wpDom: document.querySelectorAll(".legacy-routesnap-wp").length
          };
        }"""
    )


def latlng_xy(page, lat: float, lng: float) -> tuple[float, float]:
    pt = page.evaluate(
        """([lat, lng]) => {
          const map = window.__ttMap;
          const p = map.latLngToContainerPoint([lat, lng]);
          const r = map.getContainer().getBoundingClientRect();
          return { x: r.left + p.x, y: r.top + p.y };
        }""",
        [lat, lng],
    )
    return pt["x"], pt["y"]


def click_map_ll(page, lat: float, lng: float) -> None:
    x, y = latlng_xy(page, lat, lng)
    click_xy(page, x, y)


def click_edit_node(page, frac: float) -> None:
    box = page.evaluate(
        """(frac) => {
          const nodes = [...document.querySelectorAll(".tracktoolbox-edit-node")];
          if (nodes.length < 3) return null;
          const i = Math.max(1, Math.min(nodes.length - 2, Math.round((nodes.length - 1) * frac)));
          const r = nodes[i].getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, i, n: nodes.length };
        }""",
        frac,
    )
    if not box:
        raise RuntimeError("no edit nodes")
    print("edit-node", box, file=sys.stderr)
    click_xy(page, box["x"], box["y"])


def click_ll(page, lat: float, lng: float) -> None:
    pt = page.evaluate(
        """([lat, lng]) => {
          const map = window.__ttMap;
          const p = map.latLngToContainerPoint([lat, lng]);
          const r = map.getContainer().getBoundingClientRect();
          return { x: r.left + p.x, y: r.top + p.y };
        }""",
        [lat, lng],
    )
    cursor_to(page, pt["x"], pt["y"])
    info = page.evaluate(
        """([lat, lng]) => {
          const map = window.__ttMap;
          const Lref = window.__L || window.L;
          const clicks = map._events && map._events.click;
          let rs = null;
          if (clicks) {
            for (const id of Object.keys(clicks)) {
              const ctx = clicks[id].ctx;
              if (ctx && typeof ctx._onMapClick === "function") rs = ctx;
            }
          }
          if (!rs) return { ok: false, reason: "no-rs" };
          rs._onMapClick({ latlng: Lref.latLng(lat, lng) });
          return { ok: true, nwp: rs._waypoints.length, routing: !!rs._routing, status: rs._status && rs._status.textContent };
        }""",
        [lat, lng],
    )
    print("station", info, file=sys.stderr)
    page.evaluate(
        """() => {
          const c = document.getElementById("__demo-cursor");
          c.style.transform = "translate(-50%,-50%) scale(0.75)";
          setTimeout(() => { c.style.transform = "translate(-50%,-50%) scale(1)"; }, 120);
        }"""
    )
    shot(page, 2)


def wait_not_routing(page) -> None:
    page.wait_for_function(
        """() => {
          const s = document.querySelector(".legacy-routesnap-status");
          return s && !/Routing/.test(s.textContent || "");
        }""",
        timeout=60000,
    )


def main() -> int:
    if FRAMES.exists():
        shutil.rmtree(FRAMES)
    FRAMES.mkdir(parents=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        page = browser.new_page(
            viewport=VIEW,
            device_scale_factor=1,
            is_mobile=True,
            has_touch=True,
            accept_downloads=True,
        )
        page.add_init_script(INIT)
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.add_style_tag(
            content="""
            [id^="kofi-widget-overlay-"],
            .floatingchat-container-wrap,
            .floatingchat-container-wrap-mobi,
            .floating-chat-kofi-popup-iframe,
            .floating-chat-kofi-popup-iframe-mobi { display: none !important; }
            """
        )
        page.wait_for_selector("#tracktoolbox-welcome-close", timeout=30000)
        page.evaluate(CURSOR)
        wait_shot(page, 400)

        click_sel(page, "#tracktoolbox-welcome-close")
        page.wait_for_selector("#tracktoolbox-welcome-overlay", state="hidden", timeout=10000)
        wait_shot(page, 500)

        page.set_input_files("#tracktoolbox-file-input", str(KML))
        page.wait_for_function(
            """() => document.querySelectorAll("#tracktoolbox-track-list .tracktoolbox-track-item").length >= 19""",
            timeout=30000,
        )
        wait_shot(page, 2200)

        page.keyboard.press("Control+a")
        page.wait_for_function(
            """() => (document.getElementById("tracktoolbox-sel-count") || {}).textContent.includes("19")""",
            timeout=8000,
        )
        wait_shot(page, 500)
        for name in KEEPERS:
            click_sel(page, f'button.tracktoolbox-track-item:text-is("{name}")')
            wait_shot(page, 280)
        click_sel(page, "#tracktoolbox-remove")
        page.wait_for_function(
            """() => document.querySelectorAll("#tracktoolbox-track-list .tracktoolbox-track-item").length === 3""",
            timeout=10000,
        )
        wait_shot(page, 900)

        click_sel(page, 'button.tracktoolbox-track-item:text-is("Nadine")')
        wait_shot(page, 400)
        page.keyboard.press("e")
        page.wait_for_selector("#tracktoolbox-edit-toolbox:not(.is-hidden)", timeout=15000)
        page.evaluate("() => window.__ttMap && window.__ttMap.invalidateSize()")
        wait_shot(page, 800)

        click_sel(page, 'button.tracktoolbox-edit-tool[data-tool="trimBefore"]')
        wait_shot(page, 400)
        click_edit_node(page, 0.22)
        wait_shot(page, 900)

        click_sel(page, 'button.tracktoolbox-edit-tool[data-tool="trimAfter"]')
        wait_shot(page, 400)
        click_edit_node(page, 0.72)
        wait_shot(page, 900)

        click_sel(page, "#tracktoolbox-edit-save")
        page.wait_for_selector("#tracktoolbox-confirm-yes", timeout=8000)
        wait_shot(page, 400)
        click_sel(page, "#tracktoolbox-confirm-yes")
        page.wait_for_selector("#tracktoolbox-edit-toolbox", state="hidden", timeout=10000)
        wait_shot(page, 800)

        click_sel(page, 'button.tracktoolbox-track-item:text-is("Nadine")')
        page.wait_for_timeout(400)
        page.evaluate(
            """() => {
              const map = window.__ttMap;
              map.panBy([0, 24], { animate: false });
            }"""
        )
        wait_shot(page, 600)

        click_sel(page, "a.legacy-routesnap-toggle")
        page.wait_for_selector(".legacy-routesnap-panel:not([hidden])", timeout=10000)
        # leave the toggle so the help overlay unpins
        page.mouse.move(195, 480)
        page.evaluate("() => window.__moveCursor(195, 480)")
        wait_shot(page, 500)

        for i, (lat, lng) in enumerate(STATIONS):
            click_ll(page, lat, lng)
            print("after click", i, rs_status(page), file=sys.stderr)
            if i == 0:
                wait_shot(page, 500)
                continue
            deadline = time.time() + 45
            while time.time() < deadline:
                shot(page)
                page.wait_for_timeout(160)
                st = rs_status(page)
                if st["save"] and "Routing" not in (st["status"] or "") and "nicht verfügbar" not in (st["status"] or ""):
                    break
                if "nicht verfügbar" in (st["status"] or ""):
                    print("router failed", st, file=sys.stderr)
                    return 2
            wait_shot(page, 400)
            print("leg done", i, rs_status(page), file=sys.stderr)

        click_sel(page, 'button[title="Add to tracks"]')
        page.wait_for_selector("#legacy-routesnap-track-name", timeout=10000)
        wait_shot(page, 300)
        page.fill("#legacy-routesnap-track-name", ROUTE_NAME)
        wait_shot(page, 400)
        click_sel(page, ".legacy-routesnap-dialog-btn-primary")
        page.wait_for_function(
            """(name) => [...document.querySelectorAll(".tracktoolbox-track-item")].some(b => b.textContent === name)""",
            arg=ROUTE_NAME,
            timeout=15000,
        )
        wait_shot(page, 700)

        page.evaluate("() => { const el = document.activeElement; if (el && el.blur) el.blur(); }")
        page.keyboard.press("Control+d")
        wait_shot(page, 350)
        for i, old in enumerate(("Bernhard", "Vroni", "Nadine", ROUTE_NAME), start=1):
            sel = f'button.tracktoolbox-track-item:text-is("{old}")'
            page.locator(sel).scroll_into_view_if_needed()
            click_sel(page, sel)
            on = page.evaluate(
                """(name) => {
                  const b = [...document.querySelectorAll(".tracktoolbox-track-item")]
                    .find(x => x.textContent === name);
                  return !!(b && b.classList.contains("is-selected"));
                }""",
                old,
            )
            if not on:
                click_sel(page, sel)
            page.fill("#tracktoolbox-name", f"Track {i}")
            page.locator("#tracktoolbox-name").press("Tab")
            wait_shot(page, 450)

        page.evaluate(
            """() => {
              const el = document.activeElement;
              if (el && el.blur) el.blur();
              const list = document.getElementById("tracktoolbox-track-list");
              if (list) list.scrollTop = 0;
            }"""
        )
        wait_shot(page, 700)
        page.keyboard.press("Control+a")
        page.wait_for_function(
            """() => (document.getElementById("tracktoolbox-sel-count") || {}).textContent.includes("4")""",
            timeout=8000,
        )
        wait_shot(page, 800)
        click_sel(page, "#tracktoolbox-dl-kml")
        page.wait_for_selector("#tracktoolbox-kofi-overlay", state="visible", timeout=10000)
        shot(page, copies=17)

        browser.close()

    print(f"frames={n}", file=sys.stderr)
    if n < 10:
        print("too few frames", file=sys.stderr)
        return 1

    frames = sorted(FRAMES.glob("*.png"))
    subprocess.check_call(
        ["magick", "-delay", "12", "-loop", "0", *[str(f) for f in frames], "-resize", "390x", "-layers", "optimize", str(GIF)]
    )
    print(GIF, GIF.stat().st_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
