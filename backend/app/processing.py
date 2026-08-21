"""Point cloud processing pipeline: voxel downsample, RANSAC ground plane
segmentation and grid-based Euclidean clustering. Pure NumPy for speed."""
from __future__ import annotations

from typing import List, Tuple

import numpy as np


def voxel_downsample(points: np.ndarray, voxel: float = 0.15) -> np.ndarray:
    """Average points per voxel; returns indices of representative points."""
    keys = np.floor(points / voxel).astype(np.int64)
    _, first_idx, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    return first_idx  # one representative (first) point per voxel


def ransac_ground(points: np.ndarray, iters: int = 40, dist_thresh: float = 0.12,
                  rng: np.random.Generator | None = None) -> np.ndarray:
    """Return boolean mask of ground-plane inliers (plane fit on z-dominated scene)."""
    rng = rng or np.random.default_rng(0)
    n = len(points)
    if n < 3:
        return np.zeros(n, bool)
    best_inliers = np.zeros(n, bool)
    sample = points[rng.choice(n, min(n, 20000), replace=False)]
    for _ in range(iters):
        p = sample[rng.choice(len(sample), 3, replace=False)]
        normal = np.cross(p[1] - p[0], p[2] - p[0])
        norm = np.linalg.norm(normal)
        if norm < 1e-6 or abs(normal[2] / norm) < 0.85:  # plane must be near-horizontal
            continue
        normal /= norm
        d = np.abs(sample @ normal - normal @ p[0])
        inl = d < dist_thresh
        if inl.sum() > best_inliers.sum() if best_inliers.size else inl.sum() > 0:
            if inl.sum() >= best_inliers.sum():
                best_inliers = inl
    # expand mask back to full cloud using the same plane distance test
    if best_inliers.any():
        gs = sample[best_inliers]
        normal = np.linalg.svd(gs - gs.mean(0), full_matrices=False)[2][-1]
        d_off = normal @ gs.mean(0)
        return np.abs(points @ normal - d_off) < dist_thresh * 1.5
    return best_inliers


def grid_clusters(points: np.ndarray, cell: float = 1.2, min_points: int = 8,
                  max_clusters: int = 32) -> np.ndarray:
    """Fast connected-component clustering over a hashed 3D grid.

    Returns (n_clusters, 9) array: [x, y, z, dx, dy, dz, yaw, count, mean_intensity]
    Axis-aligned bounding boxes (yaw estimated via PCA on XY)."""
    if len(points) == 0:
        return np.zeros((0, 9))
    keys = np.floor(points[:, :2] / cell).astype(np.int64)
    encoded = keys[:, 0] * 2**24 + keys[:, 1]
    uniq = np.unique(encoded)
    lut = {k: i for i, k in enumerate(uniq)}
    cell_id = np.fromiter((lut[k] for k in encoded), dtype=np.int64, count=len(encoded))
    # union-find over 8-neighbourhood cells
    parent = list(range(len(uniq)))
    idx_of = {k: np.where(encoded == k)[0] for k in uniq}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    key_set = set(lut)
    for k in uniq:
        cx, cy = k // 2**24, k % 2**24
        for ddx in (-1, 0, 1):
            for ddy in (-1, 0, 1):
                nk = (cx + ddx) * 2**24 + (cy + ddy)
                if nk in key_set:
                    ra, rb = find(lut[k]), find(lut[nk])
                    if ra != rb:
                        parent[ra] = rb

    groups: dict[int, List[int]] = {}
    roots = np.fromiter((find(i) for i in cell_id), dtype=np.int64, count=len(cell_id))
    for r in np.unique(roots):
        m = roots == r
        if m.sum() >= min_points:
            groups[r] = np.where(m)[0].tolist()

    out = []
    for ids in list(groups.values())[:max_clusters]:
        c = points[ids]
        mn, mx = c.min(0), c.max(0)
        ctr = (mn + mx) / 2
        dim = np.maximum(mx - mn, 0.3)
        if dim[0] > 25 or dim[1] > 25:  # skip sprawling ground-ish blobs
            continue
        xy = c[:, :2] - c[:, :2].mean(0)
        _, _, vt = np.linalg.svd(xy, full_matrices=False)
        yaw = float(np.arctan2(vt[0, 1], vt[0, 0]))
        inten = float(np.mean(c[:, 3])) if c.shape[1] > 3 else 0.5
        out.append([ctr[0], ctr[1], ctr[2], dim[0], dim[1], dim[2], yaw, len(ids), inten])
    return np.array(out, np.float64)


def range_histogram(points: np.ndarray, bins: int = 32, max_range: float = 80.0) -> np.ndarray:
    r = np.hypot(points[:, 0], points[:, 1])
    h, _ = np.histogram(r, bins=bins, range=(0, max_range))
    return h
