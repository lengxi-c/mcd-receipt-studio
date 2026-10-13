"""Generate the two seamless, embedded paper grain tiles (development only)."""

from pathlib import Path
from random import Random

from PIL import Image, ImageDraw


SIZE = 128
HERE = Path(__file__).parent


def make_tile(name: str, seed: int, vintage: bool) -> None:
    rng = Random(seed)
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pixels = image.load()

    for y in range(SIZE):
        for x in range(SIZE):
            roll = rng.random()
            if vintage:
                if roll < 0.48:
                    pixels[x, y] = (83, 66, 37, rng.randint(3, 12))
                elif roll < 0.82:
                    pixels[x, y] = (255, 250, 226, rng.randint(4, 15))
                elif roll < 0.85:
                    pixels[x, y] = (80, 63, 37, rng.randint(15, 36))
            else:
                if roll < 0.33:
                    pixels[x, y] = (67, 77, 80, rng.randint(2, 6))
                elif roll < 0.57:
                    pixels[x, y] = (255, 255, 255, rng.randint(2, 7))
                elif roll < 0.575:
                    pixels[x, y] = (69, 77, 78, rng.randint(7, 14))

    # Sparse short fibres stay subtle at receipt size and prevent a digital dot pattern.
    draw = ImageDraw.Draw(image)
    count = 170 if vintage else 55
    for _ in range(count):
        x, y = rng.randrange(SIZE), rng.randrange(SIZE)
        length = rng.randint(1, 4 if vintage else 3)
        color = (91, 74, 43, rng.randint(12, 28)) if vintage else (86, 95, 95, rng.randint(5, 12))
        for shift in (-SIZE, 0, SIZE):
            draw.line((x + shift, y, x + shift + length, y), fill=color, width=1)

    image.save(HERE / name, optimize=True)


if __name__ == "__main__":
    make_tile("vintage-matte.png", 20261013, True)
    make_tile("cool-grey-white.png", 20261014, False)
