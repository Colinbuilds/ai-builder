#!/usr/bin/env bash
# Builds ocr/ for trial.html: on-device text reading (tesseract.js) used when the viewer
# can't send photos to Claude (the Claude desktop app). Publish ocr/ next to trial.html.
#   bash scripts/fetch-ocr.sh [out-dir]   (default: ./ocr, which is git-ignored)
set -euo pipefail
OUT="${1:-ocr}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && npm pack --silent tesseract.js@5.1.1 tesseract.js-core@5.1.1 @tesseract.js-data/eng@1.0.0 >/dev/null )
for f in "$TMP"/*.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
mkdir -p "$OUT/core" "$OUT/lang"
cp "$TMP"/tesseract.js-5.1.1/package/dist/tesseract.min.js "$TMP"/tesseract.js-5.1.1/package/dist/worker.min.js "$OUT/"
cp "$TMP"/tesseract.js-core-5.1.1/package/tesseract-core-lstm.wasm.js "$TMP"/tesseract.js-core-5.1.1/package/tesseract-core-simd-lstm.wasm.js "$OUT/core/"
# The artifact host serves no .gz files, so the English model ships as base64 text.
base64 -w0 "$TMP"/tesseract.js-data-eng-1.0.0/package/4.0.0_best_int/eng.traineddata.gz > "$OUT/lang/eng-traineddata-gz.b64.txt"
# tesseract.js 5.1.1 bug: initialize() joins language objects by their data instead of their code.
sed -i 's/return"string"==typeof t?t:t.data})).join("+")/return"string"==typeof t?t:t.code})).join("+")/' "$OUT/worker.min.js"
grep -q 't:t.code})).join("+")' "$OUT/worker.min.js" || { echo "worker.min.js patch did not apply" >&2; exit 1; }
echo "wrote $OUT/"
