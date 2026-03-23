from collections import Counter
from pathlib import Path

import csv

import matplotlib
import matplotlib.pyplot as plt


def load_dataset(csv_path: Path):
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    # Columns:
    # podiumSegments_1to3,freq1stSegments,freq2ndSegments,freq3rdSegments,dnsSegmentsCount,dnsLevelName
    out = []
    for r in rows:
        podium = int(r["podiumSegments_1to3"])
        dns_level = r["dnsLevelName"]
        out.append((dns_level, podium))
    return out


def build_tree(records):
    # Required structure:
    # root -> skip none / skip other
    # each -> top3 >=7 / <7
    # for skip=Other only: split each top3 branch by
    #   (most-winning skipped level in Other) vs (other skipped levels)
    total = len(records)

    none_rows = [(lvl, p) for (lvl, p) in records if lvl == "none"]
    other_rows = [(lvl, p) for (lvl, p) in records if lvl != "none"]

    # most-winning skipped level within skip=Other
    other_level_counts = Counter(lvl for (lvl, _p) in other_rows)
    top_other_level = None
    if other_level_counts:
        top_other_level = sorted(other_level_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

    def split_top7(rows):
        ge7 = [(lvl, p) for (lvl, p) in rows if p >= 7]
        lt7 = [(lvl, p) for (lvl, p) in rows if p < 7]
        return ge7, lt7

    none_ge7, none_lt7 = split_top7(none_rows)
    other_ge7, other_lt7 = split_top7(other_rows)

    def split_top_level(rows, top_level):
        if top_level is None:
            return [], rows
        top = [(lvl, p) for (lvl, p) in rows if lvl == top_level]
        rest = [(lvl, p) for (lvl, p) in rows if lvl != top_level]
        return top, rest

    other_ge7_top, other_ge7_rest = split_top_level(other_ge7, top_other_level)
    other_lt7_top, other_lt7_rest = split_top_level(other_lt7, top_other_level)

    return {
        "total": total,
        "top_other_level": top_other_level,
        "none_count": len(none_rows),
        "other_count": len(other_rows),
        "none_ge7": len(none_ge7),
        "none_lt7": len(none_lt7),
        "other_ge7": len(other_ge7),
        "other_lt7": len(other_lt7),
        "other_ge7_top": len(other_ge7_top),
        "other_ge7_rest": len(other_ge7_rest),
        "other_lt7_top": len(other_lt7_top),
        "other_lt7_rest": len(other_lt7_rest),
    }


def draw_tree(tree, out_png: Path, out_pdf: Path):
    total = tree["total"]
    top_other_level = tree["top_other_level"] or "(none)"

    # Layout: upside-down (root at bottom, branches above)
    root_y = 0.0
    l1_y = 1.0
    l2_y = 2.0
    l3_y = 3.0

    # Figure
    fig, ax = plt.subplots(figsize=(16, 9))
    ax.set_axis_off()

    def box(ax, x, y, text):
        # Draw a rounded rectangle with centered text
        rect = matplotlib.patches.FancyBboxPatch(
            (x - 0.95, y - 0.14),
            1.9,
            0.28,
            boxstyle="round,pad=0.02,rounding_size=0.06",
            linewidth=1.0,
            edgecolor="#444",
            facecolor="#2b2b2b",
            alpha=0.95,
        )
        ax.add_patch(rect)
        ax.text(
            x,
            y,
            text,
            ha="center",
            va="center",
            color="white",
            fontsize=7.4,
            wrap=True,
        )

    def arrow(ax, x1, y1, x2, y2):
        ax.annotate(
            "",
            xy=(x2, y2),
            xytext=(x1, y1),
            arrowprops=dict(arrowstyle="->", lw=1.1, color="#444"),
        )

    # Root
    root_label = f"Winners ({total} runs)"
    root_x = 0.0
    box(ax, root_x, root_y, root_label)

    # Fixed coordinates for requested structure
    x_none = -4.2
    x_other = 4.2
    x_none_lt7 = -6.0
    x_none_ge7 = -2.4
    x_other_lt7 = 2.4
    x_other_ge7 = 6.0
    x_other_lt7_top = 1.2
    x_other_lt7_rest = 3.6
    x_other_ge7_top = 4.8
    x_other_ge7_rest = 7.2

    min_x = -8.8
    max_x = 8.8
    min_y = root_y - 0.8
    max_y = l3_y + 1.0
    ax.set_xlim(min_x, max_x)
    ax.set_ylim(min_y, max_y)

    # Level 1: skip none / skip other
    none_count = tree["none_count"]
    other_count = tree["other_count"]
    none_pct = (100.0 * none_count / total) if total else 0.0
    other_pct = (100.0 * other_count / total) if total else 0.0
    box(ax, x_none, l1_y, f"skip=none\n{none_count} ({none_pct:.1f}%)")
    box(ax, x_other, l1_y, f"skip=Other\n{other_count} ({other_pct:.1f}%)")
    arrow(ax, root_x, root_y + 0.18, x_none, l1_y - 0.18)
    arrow(ax, root_x, root_y + 0.18, x_other, l1_y - 0.18)

    # Level 2: top3 <7 / >=7 for each branch
    box(ax, x_none_lt7, l2_y, f"top3 < 7\n{tree['none_lt7']}")
    box(ax, x_none_ge7, l2_y, f"top3 >= 7\n{tree['none_ge7']}")
    box(ax, x_other_lt7, l2_y, f"top3 < 7\n{tree['other_lt7']}")
    box(ax, x_other_ge7, l2_y, f"top3 >= 7\n{tree['other_ge7']}")
    arrow(ax, x_none, l1_y + 0.18, x_none_lt7, l2_y - 0.18)
    arrow(ax, x_none, l1_y + 0.18, x_none_ge7, l2_y - 0.18)
    arrow(ax, x_other, l1_y + 0.18, x_other_lt7, l2_y - 0.18)
    arrow(ax, x_other, l1_y + 0.18, x_other_ge7, l2_y - 0.18)

    # Level 3: for skip=Other branch only -> top skipped level vs rest
    box(
        ax,
        x_other_lt7_top,
        l3_y,
        f"skipLevel={top_other_level}\n{tree['other_lt7_top']}",
    )
    box(ax, x_other_lt7_rest, l3_y, f"other levels\n{tree['other_lt7_rest']}")
    arrow(ax, x_other_lt7, l2_y + 0.18, x_other_lt7_top, l3_y - 0.18)
    arrow(ax, x_other_lt7, l2_y + 0.18, x_other_lt7_rest, l3_y - 0.18)

    box(
        ax,
        x_other_ge7_top,
        l3_y,
        f"skipLevel={top_other_level}\n{tree['other_ge7_top']}",
    )
    box(ax, x_other_ge7_rest, l3_y, f"other levels\n{tree['other_ge7_rest']}")
    arrow(ax, x_other_ge7, l2_y + 0.18, x_other_ge7_top, l3_y - 0.18)
    arrow(ax, x_other_ge7, l2_y + 0.18, x_other_ge7_rest, l3_y - 0.18)

    # Save (avoid tight_layout cutoff)
    fig.subplots_adjust(left=0.04, right=0.98, top=0.98, bottom=0.04)
    fig.savefig(out_png, dpi=220, bbox_inches="tight")
    fig.savefig(out_pdf, bbox_inches="tight")
    plt.close(fig)


def main():
    repo_dir = Path(__file__).resolve().parents[1]
    csv_path = repo_dir / "tools" / "mc_winners_dataset.csv"
    out_png = repo_dir / "tools" / "mc_winners_tree_upside_down.png"
    out_pdf = repo_dir / "tools" / "mc_winners_tree_upside_down.pdf"

    records = load_dataset(csv_path)
    tree = build_tree(records)
    draw_tree(tree, out_png=out_png, out_pdf=out_pdf)

    print(f"[info] Wrote: {out_png}")
    print(f"[info] Wrote: {out_pdf}")


if __name__ == "__main__":
    main()

