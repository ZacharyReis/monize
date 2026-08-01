# Embedded PDF fonts

`roboto-regular.ts` and `roboto-bold.ts` hold base64-encoded **subsets** of
Roboto, embedded by jsPDF so report PDFs render UTF-8 text (Polish and other
Latin-Extended, Cyrillic and Greek) instead of jsPDF's WinAnsi-only built-in
Helvetica. See `../pdf-fonts.ts` for how they are registered.

Only a subset is vendored to keep the JS bundle small; jsPDF then subsets again
at output time, so each generated PDF only embeds the glyphs it actually uses.

CJK / Devanagari are intentionally not covered (those fonts are megabytes each
and cannot ship in every PDF).

## Regenerating

Source: Roboto (Apache License 2.0 -- `Roboto-Regular.ttf`, `Roboto-Bold.ttf`
from https://github.com/googlefonts/roboto-2).

Subset with [`fonttools`](https://github.com/fonttools/fonttools)
(`pip install fonttools brotli`):

```sh
UNICODES="U+0020-007E,U+00A0-00FF,U+0100-017F,U+0180-024F,U+0250-02AF,\
U+02B0-02FF,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,\
U+2070-209F,U+20A0-20BF,U+2122,U+2190-2193,U+2212"

for w in Regular Bold; do
  pyftsubset "Roboto-$w.ttf" --unicodes="$UNICODES" \
    --output-file="Roboto-$w.subset.ttf" \
    --layout-features='' --no-hinting --desubroutinize \
    --drop-tables+=GSUB,GPOS,GDEF
done
```

Then base64-encode each into its `export const roboto{Regular,Bold} = "..."`
module (`base64 -w0 Roboto-$w.subset.ttf`).
