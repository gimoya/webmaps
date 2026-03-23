import argparse
import csv
import json
import random
from collections import Counter, defaultdict
from pathlib import Path


def points_for_rank(rank: int) -> int:
    # Matches leaderboard.js segmentPoints for non-DNS riders
    if rank == 1:
        return -3
    if rank == 2:
        return -2
    if rank == 3:
        return -1
    return rank  # 4th and worse: actual rank value


def dns_points(num_non_dns: int) -> int:
    # Matches leaderboard.js segmentPoints for DNS riders
    if num_non_dns == 0:
        return 0
    return num_non_dns + 2


def parse_segments_geojson(segments_geojson_path: Path):
    data = json.loads(segments_geojson_path.read_text(encoding="utf-8"))
    features = data.get("features", [])

    segment_to_level = {}  # canonicalName -> levelName
    segment_to_display = {}  # canonicalName -> displayName (unused for scoring, but useful for debugging)

    for feat in features:
        props = feat.get("properties", {}) or {}
        point_type = str(props.get("pointType") or props.get("type") or "").strip().lower()
        if point_type not in ("start", "end"):
            continue

        seg_name = str(props.get("canonicalName") or props.get("segmentName") or props.get("name") or "").strip()
        if not seg_name:
            continue

        level_raw = str(props.get("level") or "").strip()
        level_name = level_raw if level_raw else "(no level)"

        # Dedupe by canonicalName: segments.geojson has 2 features per segment (start/end)
        if seg_name not in segment_to_level:
            segment_to_level[seg_name] = level_name
            segment_to_display[seg_name] = str(props.get("displayName") or seg_name).strip()

    segment_names = sorted(segment_to_level.keys())
    level_to_segments = defaultdict(list)
    for seg_name in segment_names:
        level_to_segments[segment_to_level[seg_name]].append(seg_name)
    for lvl in level_to_segments:
        level_to_segments[lvl].sort()

    # Mimic leaderboard.js ordering: '(no level)' last if present
    other_levels = sorted([lvl for lvl in level_to_segments.keys() if lvl != "(no level)"])
    no_level = "(no level)" if "(no level)" in level_to_segments else None
    all_levels = other_levels + ([no_level] if no_level else [])

    return {
        "segment_names": segment_names,
        "segment_to_level": segment_to_level,
        "level_to_segments": level_to_segments,
        "levels": all_levels,
        "segment_to_level_index": {seg: all_levels.index(segment_to_level[seg]) for seg in segment_names},
    }


def monte_carlo_winners(
    segment_names,
    segment_to_level_index,
    levels,
    runs: int,
    riders: int,
    seed: int,
    out_csv_path: Path,
    rng_seed_note: str = "",
):
    seg_level_indices = [segment_to_level_index[seg] for seg in segment_names]
    num_segments = len(segment_names)
    num_levels = len(levels)

    # Rider skip level: -1 means "no DNS" (skipLevel=none), else 0..num_levels-1
    # DNS on a segment if skip_level_idx == seg_level_idx
    rng = random.Random(seed)

    pair_counts = Counter()

    with out_csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "podiumSegments_1to3",
                "freq1stSegments",
                "freq2ndSegments",
                "freq3rdSegments",
                "dnsSegmentsCount",
                "dnsLevelName",
            ]
        )

        for _ in range(runs):
            # 1) For each rider, randomly choose either:
            #    - no DNS level (skipLevel = none)
            #    - exactly one DNS level L (DNS on all segments with segment.level == L)
            #
            # Coin flip for "has DNS level" vs "none", then uniform among levels.
            skip_level_idx = []
            for _r in range(riders):
                if rng.random() < 0.5:
                    # choose one level uniformly among existing levels
                    skip_level_idx.append(rng.randrange(0, num_levels))
                else:
                    skip_level_idx.append(-1)

            # 2) simulate all segments and score all riders
            scores = [0] * riders
            # store per-segment rank for each rider: -1 means DNS
            ranks = [[-1] * riders for _s in range(num_segments)]

            for seg_idx in range(num_segments):
                seg_level_idx = seg_level_indices[seg_idx]

                participants = [r for r in range(riders) if skip_level_idx[r] != seg_level_idx]
                n = len(participants)
                dns_pts = dns_points(n)

                # DNS riders
                for r in range(riders):
                    if skip_level_idx[r] == seg_level_idx:
                        scores[r] += dns_pts

                # Non-DNS ranks: random permutation of 1..n
                rng.shuffle(participants)
                for i, r in enumerate(participants):
                    rank = i + 1
                    ranks[seg_idx][r] = rank
                    scores[r] += points_for_rank(rank)

            # 3) overall winner: minimum total score; tie-break randomly
            min_score = min(scores)
            tied = [i for i, s in enumerate(scores) if s == min_score]

            # 4) winner metrics: if tie, pick exactly one tied rider uniformly
            winner = rng.choice(tied)
            dns_segments = 0
            podium_segments = 0
            freq_1 = 0
            freq_2 = 0
            freq_3 = 0
            for seg_idx in range(num_segments):
                rnk = ranks[seg_idx][winner]
                if rnk == -1:
                    dns_segments += 1
                else:
                    if 1 <= rnk <= 3:
                        podium_segments += 1
                        if rnk == 1:
                            freq_1 += 1
                        elif rnk == 2:
                            freq_2 += 1
                        elif rnk == 3:
                            freq_3 += 1

            dns_level_name = "none" if skip_level_idx[winner] == -1 else levels[skip_level_idx[winner]]
            writer.writerow([podium_segments, freq_1, freq_2, freq_3, dns_segments, dns_level_name])
            # Pair key for the separate frequency CSV:
            #   (freq1Segments, freq2Segments, freq3Segments, dnsSegmentsCount)
            pair_counts[(freq_1, freq_2, freq_3, dns_segments)] += 1

    # write pair frequency distribution as separate CSV (optional analysis)
    pair_csv_path = out_csv_path.with_name("mc_pair_frequency.csv")
    with pair_csv_path.open("w", encoding="utf-8", newline="") as pf:
        w = csv.writer(pf)
        w.writerow(["freq1Segments", "freq2Segments", "freq3Segments", "freq1to3Segments", "dnsSegmentsCount", "frequency"])
        for (f1, f2, f3, dns_segments), cnt in pair_counts.most_common():
            w.writerow([f1, f2, f3, (f1 + f2 + f3), dns_segments, cnt])
    return {
        "pair_frequency_path": str(pair_csv_path),
        "output_csv_path": str(out_csv_path),
    }


def main():
    repo_dir = Path(__file__).resolve().parents[1]
    segments_geojson_path = repo_dir / "data" / "segments.geojson"
    tools_dir = repo_dir / "tools"

    parser = argparse.ArgumentParser(description="Monte Carlo simulation of overall winners.")
    parser.add_argument("--runs", type=int, default=10000)
    parser.add_argument("--riders", type=int, default=15)
    parser.add_argument("--seed", type=int, default=12345)
    args = parser.parse_args()

    parsed = parse_segments_geojson(segments_geojson_path)
    segment_names = parsed["segment_names"]
    levels = parsed["levels"]
    segment_to_level_index = parsed["segment_to_level_index"]

    if len(segment_names) != 21:
        print(f"[warn] Parsed segment count = {len(segment_names)} (expected 21).")

    out_csv_path = tools_dir / "mc_winners_dataset.csv"
    print(f"[info] Running MC: runs={args.runs}, riders={args.riders}, segments={len(segment_names)}, levels={len(levels)}")
    print(f"[info] Output CSV: {out_csv_path}")

    monte_carlo_winners(
        segment_names=segment_names,
        segment_to_level_index=segment_to_level_index,
        levels=levels,
        runs=args.runs,
        riders=args.riders,
        seed=args.seed,
        out_csv_path=out_csv_path,
    )

    print("[info] Done.")
    print("[info] Pair frequency CSV: tools/mc_pair_frequency.csv")


if __name__ == "__main__":
    main()

