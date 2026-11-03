# Third-party resources

The repository MIT license applies to the new OpenGlyph Harness integration code and documentation. It does not relicense dependencies, fonts or third-party source code.

## OpenGlyph-LaTeX resources

The bundled runtime is copied from [OpenGlyph-LaTeX](https://github.com/Open-Glyph/OpenGlyph-LaTeX), commit `824fa2d3d8b0d5d23e9b74462522e6c3ef835627`, package v0.2.0. The source library's own license and third-party notice are retained in `assets/openglyph-latex/`. `resources.json` records the original and compressed-file SHA256 values; compression does not change the recovered source bytes.

The 22,583-form ebag OTF and catalog derive from GlyphWiki `ebag_s` and its pinned dependencies, not from the local SEAL font or private materials. Retain `assets/openglyph-latex/licenses/GlyphWiki.txt` and the source metadata when redistributing. The font is compressed for distribution and expanded only in the user's work directory.

The optional offline builder invokes the KAGE JavaScript engine in a separate Node process. Its eight unmodified source files and GNU GPL v3 `COPYING` are retained in `assets/openglyph-latex/vendor/kage-engine/`. This notice does not classify that engine as MIT or offer a legal conclusion about process boundaries.

No original paper scans, local unverified IDS tables, query-image collections, DINO/YOLO weights or user files are included.

## Runtime dependencies

`@resvg/resvg-js` 2.6.2 rasterizes real component SVG contact sheets. It is obtained from its npm distribution under MPL-2.0; its own license is not replaced by this repository license. AJV, Schemastery and DeepSeek Harness dependencies retain their respective licenses and are installed separately.

FontTools, skia-pathops and pypdf are optional Python dependencies installed into a user-requested workspace virtual environment. Their binaries are not vendored. Tectonic/XeLaTeX must be installed or configured by the user; this plugin does not redistribute their executables or silently install an operating-system TeX distribution.
