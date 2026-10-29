"""The one piece of YAML Jarvis has to understand.

``apps/<name>/kustomization.yaml`` pins every image the app runs, and that pin
is the boundary between Git and the cluster: change it and ArgoCD rolls out,
leave it and nothing happens no matter what is published to GHCR. The console's
delivery table is built on reading it.

Parsing it with a few lines of text handling rather than a YAML library is a
deliberate trade. The structure is fixed by the Kustomize schema — a list of
``{name, newTag}`` under ``images:`` — PyYAML is only an optional dependency
here (it arrives with ``jarvis[k8s]``), and the same parser is what the write
path will need when it rewrites the tag without reformatting the file.

Example:
    >>> text = '''images:
    ...   - name: ghcr.io/gmottola00/tickup-web
    ...     newTag: 4f5e7497
    ... '''
    >>> parse_images(text)
    [ImagePin(name='ghcr.io/gmottola00/tickup-web', new_tag='4f5e7497', new_name='')]
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_LIST_ITEM = re.compile(r"^(\s*)-\s+(.*)$")
_KEY_VALUE = re.compile(r"^(\s*)([A-Za-z][\w.-]*)\s*:\s*(.*)$")


@dataclass(frozen=True)
class ImagePin:
    """One entry of the ``images:`` list."""

    name: str
    new_tag: str = ""
    new_name: str = ""

    @property
    def short(self) -> str:
        """The image name without its registry and owner: ``tickup-web``."""
        return (self.new_name or self.name).rsplit("/", 1)[-1]


def _strip_comment(value: str) -> str:
    """Drop a trailing ``# comment``, respecting quotes."""
    quote = ""
    for index, char in enumerate(value):
        if char in "\"'" and not quote:
            quote = char
        elif char == quote:
            quote = ""
        elif char == "#" and not quote and (index == 0 or value[index - 1].isspace()):
            return value[:index]
    return value


def _clean(value: str) -> str:
    return _strip_comment(value).strip().strip("\"'")


def parse_images(text: str) -> list[ImagePin]:
    """Return the image pins declared in a kustomization file.

    Tolerant by design: unknown keys are ignored, comments and blank lines are
    skipped, and a malformed entry yields nothing rather than raising. A
    delivery table that drops one row is better than a page that 500s.
    """
    lines = text.splitlines()
    pins: list[ImagePin] = []

    inside = False
    indent = 0
    current: dict[str, str] = {}

    def flush() -> None:
        if current.get("name"):
            pins.append(
                ImagePin(
                    name=current["name"],
                    new_tag=current.get("newTag", ""),
                    new_name=current.get("newName", ""),
                )
            )
        current.clear()

    for raw in lines:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue

        key_value = _KEY_VALUE.match(raw)

        if not inside:
            if key_value and key_value.group(2) == "images" and not _clean(key_value.group(3)):
                inside = True
                indent = len(key_value.group(1))
            continue

        # A key at or below the `images:` indentation ends the block.
        if key_value and len(key_value.group(1)) <= indent and not raw.lstrip().startswith("-"):
            break

        item = _LIST_ITEM.match(raw)
        if item:
            flush()
            rest = item.group(2)
            if (pair := _KEY_VALUE.match(rest)) is not None:
                current[pair.group(2)] = _clean(pair.group(3))
            continue

        if key_value:
            current[key_value.group(2)] = _clean(key_value.group(3))

    flush()
    return pins


def replace_tag(text: str, image: str, new_tag: str) -> str:
    """Return the file with one image's ``newTag`` replaced, nothing else touched.

    Rewriting the whole document through a YAML round-trip would reflow it and
    drop its comments — and the comments in these files say things like "CI
    bumps this, do not edit by hand". A line edit keeps the diff to one line,
    which is the entire point of the GitOps flow.

    Args:
        text: The current file.
        image: The image ``name`` whose pin should change.
        new_tag: The tag to write.

    Raises:
        ValueError: The image is not pinned in this file.
    """
    lines = text.splitlines(keepends=True)
    found = False

    for index, raw in enumerate(lines):
        pair = _KEY_VALUE.match(raw.rstrip("\n"))
        stripped = raw.lstrip().lstrip("-").strip()
        if stripped.startswith("name:") and _clean(stripped[len("name:") :]) == image:
            found = True
            continue
        if found and pair is not None and pair.group(2) == "newTag":
            lines[index] = f"{pair.group(1)}newTag: {new_tag}\n"
            return "".join(lines)
        if found and stripped.startswith("- "):
            break

    raise ValueError(f"{image!r} has no newTag pin in this kustomization")


def _block(lines: list[str], key: str) -> tuple[int, int, int] | None:
    """Locate a top-level list block: ``(header index, end index, header indent)``.

    The end is the first line after the block's last non-blank line, so an
    insertion there lands inside the block and above any trailing blank lines.
    """
    start = -1
    indent = 0
    end = len(lines)
    last = -1
    for index, raw in enumerate(lines):
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        pair = _KEY_VALUE.match(line)
        if start < 0:
            if pair and pair.group(2) == key and not _clean(pair.group(3)):
                start, indent, last = index, len(pair.group(1)), index
            continue
        if pair and len(pair.group(1)) <= indent and not line.lstrip().startswith("-"):
            end = index
            break
        last = index
    if start < 0:
        return None
    return start, min(end, last + 1), indent


def parse_replicas(text: str) -> dict[str, int]:
    """Return the ``replicas:`` overrides in a kustomization, by Deployment name.

    Example:
        >>> parse_replicas("replicas:\\n  - name: tickup-backend\\n    count: 0\\n")
        {'tickup-backend': 0}
    """
    lines = text.splitlines(keepends=True)
    located = _block(lines, "replicas")
    if located is None:
        return {}
    start, end, _ = located
    out: dict[str, int] = {}
    current: dict[str, str] = {}

    def flush() -> None:
        if current.get("name") and current.get("count", "").isdigit():
            out[current["name"]] = int(current["count"])
        current.clear()

    for raw in lines[start + 1 : end]:
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = _LIST_ITEM.match(line)
        if item:
            flush()
            line = item.group(2)
        if (pair := _KEY_VALUE.match(line)) is not None:
            current[pair.group(2)] = _clean(pair.group(3))
    flush()
    return out


def set_replicas(text: str, name: str, count: int) -> str:
    """Return the file with a ``replicas:`` override for one Deployment set to ``count``.

    Same line-edit discipline as :func:`replace_tag`: an existing entry has only
    its ``count`` line rewritten, a new entry is appended to the existing block,
    and a file with no block gets one at the end. Comments and the rest of the
    file are left exactly as they were.

    Args:
        text: The current file.
        name: The Deployment name, e.g. ``tickup-backend``.
        count: Replicas to run. ``0`` stops the workload.

    Raises:
        ValueError: ``count`` is negative.
    """
    if count < 0:
        raise ValueError("replica count cannot be negative")
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"

    located = _block(lines, "replicas")
    if located is None:
        return "".join(lines) + f"replicas:\n  - name: {name}\n    count: {count}\n"
    start, end, _ = located

    # Split the block into items, each a range of line indices starting at its "- ".
    items: list[list[int]] = []
    item_indent = "  "
    for index in range(start + 1, end):
        line = lines[index].rstrip("\n")
        if (item := _LIST_ITEM.match(line)) is not None:
            item_indent = item.group(1)
            items.append([index])
        elif items and line.strip() and not line.lstrip().startswith("#"):
            items[-1].append(index)

    for item_lines in items:
        keys: dict[str, int] = {}
        for index in item_lines:
            line = lines[index].rstrip("\n")
            if (item := _LIST_ITEM.match(line)) is not None:
                line = item.group(1) + "  " + item.group(2)
            if (pair := _KEY_VALUE.match(line)) is not None:
                keys[pair.group(2)] = index
        name_at = keys.get("name")
        if name_at is None or _clean(lines[name_at].split(":", 1)[1]) != name:
            continue
        if "count" in keys:
            at = keys["count"]
            prefix = lines[at][: len(lines[at]) - len(lines[at].lstrip())]
            if lines[at].lstrip().startswith("-"):
                prefix += "- "
            lines[at] = f"{prefix}count: {count}\n"
        else:
            lines.insert(item_lines[-1] + 1, f"{item_indent}  count: {count}\n")
        return "".join(lines)

    entry = f"{item_indent}- name: {name}\n{item_indent}  count: {count}\n"
    return "".join(lines[:end]) + entry + "".join(lines[end:])


__all__ = ["ImagePin", "parse_images", "parse_replicas", "replace_tag", "set_replicas"]
