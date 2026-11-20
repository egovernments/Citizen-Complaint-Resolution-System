const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
import { buildModel, decide, isKnownCtype, predictProba, textForModel, DEFAULT_CTYPE } from "./severity.js";

const ENCODER = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const SAMPLES = [
  ["Stray dogs chased and bit a child near the school gate", "Street Dogs"],
  ["Live electric wire fell on the road near the bus stop, someone got a shock", "Fallen EB cables"],
  ["Open manhole without cover on the busy road, a child almost fell in", "Covering Manholes of Storm Water Drain"],
  ["Street light not working in our lane for the last week", "Non burning of Street lights"],
  ["Need a copy of birth certificate", "Issue of Birth and Death Certificate"],
];

const $ = (id) => document.getElementById(id);
const status = (msg) => { $("status").textContent = msg; };

let model;
const encoders = {}; // dtype -> Promise<extractor>

async function loadModel() {
  const [meta, bin] = await Promise.all([
    fetch("model.json").then((r) => r.json()),
    fetch("model.bin").then((r) => r.arrayBuffer()),
  ]);
  return buildModel(meta, new Float32Array(bin));
}

let lib; // transformers.js, imported on first use so a blocked CDN shows an error instead of killing the page
function getEncoder(dtype) {
  encoders[dtype] ??= (lib ??= import(TRANSFORMERS).then((m) => { m.env.allowLocalModels = false; return m; }))
    .then(({ pipeline }) => pipeline("feature-extraction", ENCODER, {
    dtype,
    progress_callback: (p) => {
      if (p.status === "progress" && typeof p.progress === "number") {
        $("prog").hidden = false;
        $("prog").value = p.progress;
        status(`Downloading text model (${p.file.split("/").pop()}) ${Math.round(p.progress)}%`);
      }
    },
  })).then((e) => {
    e.tokenizer.model_max_length = 128; // same truncation as training
    $("prog").hidden = true;
    return e;
  });
  encoders[dtype].catch(() => { delete encoders[dtype]; lib = undefined; }); // allow a retry after a failure
  return encoders[dtype];
}

function render(result, ctype, known) {
  $("result").hidden = false;
  $("sev").textContent = result.severity;
  $("sev").className = `badge ${result.severity}`;
  $("conf").textContent = `${(result.confidence * 100).toFixed(0)}% confidence`;
  $("review").hidden = !result.needs_review;
  $("bars").innerHTML = "";
  for (const [label, p] of Object.entries(result.probabilities)) {
    $("bars").insertAdjacentHTML("beforeend",
      `<span>${label}</span><span class="track"><span class="fill ${label}" style="display:block;width:${(p * 100).toFixed(1)}%"></span></span><span class="num">${(p * 100).toFixed(1)}%</span>`);
  }
  const out = { ...result };
  if (!known) out.note = `"${ctype}" is not one of the complaint types the model was trained on; scored as an unseen type.`;
  $("json").textContent = JSON.stringify(out, null, 2);
}

async function score() {
  const description = $("desc").value;
  if (!description.trim()) { status("Type a complaint first."); $("desc").focus(); return; }
  const ctype = $("ctype").value.trim() || DEFAULT_CTYPE;
  const dtype = document.querySelector('input[name="dtype"]:checked').value;
  $("go").disabled = true;
  status("Starting...");
  try {
    status("Loading models...");
    const [m, extractor] = await Promise.all([model, getEncoder(dtype)]);
    status("Scoring...");
    const emb = await extractor(textForModel(description), { pooling: "mean", normalize: true });
    render(decide(m, predictProba(m, emb.data, ctype)), ctype, isKnownCtype(m, ctype));
    status("");
  } catch (err) {
    console.error(err);
    status(`Something went wrong: ${err.message || err}. If this mentions the network, check that cdn.jsdelivr.net and huggingface.co are reachable.`);
  } finally {
    $("go").disabled = false;
  }
}

SAMPLES.forEach(([d, c], i) => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.textContent = d.length > 38 ? d.slice(0, 36) + "..." : d;
  b.title = d;
  b.addEventListener("click", () => { $("desc").value = d; $("ctype").value = c; });
  $("samples").append(b);
});

model = loadModel();
model.then((m) => {
  $("ctypes").innerHTML = m.ctypes.map((c) => `<option value="${c.replace(/"/g, "&quot;")}">`).join("");
}).catch((err) => status(`Could not load the model files: ${err.message}`));
$("go").addEventListener("click", score);
$("desc").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) score(); });
