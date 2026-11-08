// Dev check: the browser pipeline (this folder's JS + transformers.js) vs the Python service.
//   npm i @huggingface/transformers@3.8.1   (anywhere), then:  node static-space/test/parity.mjs [fp32|q8]
// expected.json comes from the Python service for samples.json.
import { readFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { buildModel, decide, predictProba, textForModel } from "../severity.js";

const here = new URL(".", import.meta.url);
const dtype = process.argv[2] || "q8";
const samples = JSON.parse(readFileSync(new URL("samples.json", here), "utf8"));
const expected = JSON.parse(readFileSync(new URL("expected.json", here), "utf8"));
const meta = JSON.parse(readFileSync(new URL("../model.json", here), "utf8"));
const bin = readFileSync(new URL("../model.bin", here));
const model = buildModel(meta, new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4));

const extractor = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2", { dtype });
extractor.tokenizer.model_max_length = 128;

let sameLabel = 0, textOk = 0, worst = 0;
for (let i = 0; i < samples.length; i++) {
  const text = textForModel(samples[i].d);
  if (text === expected[i].text) textOk++; else console.log(`TEXT DIFF [${i}]\n js: ${JSON.stringify(text)}\n py: ${JSON.stringify(expected[i].text)}`);
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const r = decide(model, predictProba(model, out.data, samples[i].c || "Others"));
  const e = expected[i];
  const d = Math.max(...Object.keys(e.probabilities).map((k) => Math.abs(e.probabilities[k] - r.probabilities[k])));
  worst = Math.max(worst, d);
  if (r.severity === e.severity) sameLabel++;
  console.log(`${r.severity === e.severity ? "ok " : "DIFF"} js=${r.severity} (${r.confidence.toFixed(2)})  py=${e.severity} (${e.confidence.toFixed(2)})  max|dp|=${d.toFixed(3)}`);
}
console.log(`\n[${dtype}] text identical: ${textOk}/${samples.length}; same severity: ${sameLabel}/${samples.length}; worst probability gap: ${worst.toFixed(4)}`);
