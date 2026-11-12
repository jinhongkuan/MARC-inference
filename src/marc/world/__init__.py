"""The synthetic world: hidden agreements first, then the documents they leave behind.

Nothing in this package is visible to an engine except the `Corpus` that `render` returns.
"""

from marc.world.generate import WorldConfig, build_world
from marc.world.model import World, true_relationships
from marc.world.render import RenderConfig, TruthKey, render

__all__ = [
    "RenderConfig",
    "TruthKey",
    "World",
    "WorldConfig",
    "build_world",
    "render",
    "true_relationships",
]
