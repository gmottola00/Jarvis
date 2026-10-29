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


__all__ = ["ImagePin", "parse_images", "replace_tag"]
