"""NAIP aerial imagery (USGS, public domain) as a pavement mask in the pack's local metres.

fetch_mask(pack, work) -> Mask or None. Asks imagery.nationalmap.gov for the pack's box (4 bands, red to
near-infrared) at about 1 m a pixel, calls a pixel asphalt-like when it is not vegetation (NDVI), not
colourful (pools, courts, red roofs) and mid-dark (white roofs and bare lots are brighter). Cars and
shadows are mixed in, so the mask is kept per 3 m cell as the share of asphalt-like pixels.
Only used to check and trim what recognize.py proposes; the imagery itself is never stored in the pack.
"""
import io, json, math, os, time, urllib.request
import numpy as np
from PIL import Image

URL = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
CELL = 3.0


class Mask:
    def __init__(self, frac, x0, z0):
        self.frac, self.x0, self.z0 = frac, x0, z0   # frac[j, i]: asphalt share of the 3 m cell at (x0 + i*CELL, z0 + j*CELL)

    def cells(self, bounds, thresh=0.5):
        """Centres of asphalt cells inside local-metre bounds (minx, minz, maxx, maxz)."""
        i0 = max(0, int((bounds[0] - self.x0) / CELL)); i1 = min(self.frac.shape[1], int((bounds[2] - self.x0) / CELL) + 1)
        j0 = max(0, int((bounds[1] - self.z0) / CELL)); j1 = min(self.frac.shape[0], int((bounds[3] - self.z0) / CELL) + 1)
        sub = self.frac[j0:j1, i0:i1] >= thresh
        jj, ii = np.nonzero(sub)
        return self.x0 + (ii + i0 + 0.5) * CELL, self.z0 + (jj + j0 + 0.5) * CELL


def asphalt_like(a):
    R, G, B, N = [a[:, :, i].astype(float) for i in range(4)]
    ndvi = (N - R) / (N + R + 1e-6)
    mx = np.maximum(np.maximum(R, G), B); mn = np.minimum(np.minimum(R, G), B)
    sat = (mx - mn) / (mx + 1e-6); br = (R + G + B) / 765
    return (ndvi < 0.12) & (sat < 0.22) & (br < 0.62) & (br > 0.12)


def fetch_mask(pack, work, log=print):
    W, S, E, N = pack['bbox']; lon0, lat0 = pack['origin']
    KX = math.cos(math.radians(lat0)) * 111320; KY = 110540
    wm, hm = (E - W) * KX, (N - S) * KY
    px = 1.0
    w, h = int(wm / px), int(hm / px)
    if w > 4000 or h > 4000: return None
    cache = os.path.join(work, 'naip_asphalt.npy')
    if os.path.exists(cache):
        frac = np.load(cache)
    else:
        url = f'{URL}?bbox={W},{S},{E},{N}&bboxSR=4326&imageSR=4326&size={w},{h}&format=tiff&f=image'
        try:
            for attempt in range(4):  # the image server answers 5xx now and then
                try: b = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'renovated-area-builder'}), timeout=180).read(); break
                except Exception:  # noqa: BLE001
                    if attempt == 3: raise
                    time.sleep(2 * (attempt + 1))
            im = Image.open(io.BytesIO(b))
            if im.mode != 'RGBA': return None
            m = asphalt_like(np.asarray(im)).astype(float)
        except Exception as e:  # noqa: BLE001
            log(f'NAIP imagery unavailable ({type(e).__name__}: {e}); using map data only'); return None
        n = int(CELL / px); H, Wd = (m.shape[0] // n) * n, (m.shape[1] // n) * n
        frac = m[:H, :Wd].reshape(H // n, n, Wd // n, n).mean(axis=(1, 3))
        os.makedirs(work, exist_ok=True); np.save(cache, frac)
    x0, z0 = (W - lon0) * KX, -(N - lat0) * KY
    log(f'NAIP pavement mask: {int((frac >= 0.5).sum())} asphalt cells')
    return Mask(frac, x0, z0)
