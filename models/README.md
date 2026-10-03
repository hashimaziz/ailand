# Models

Local GGUF weights for the llama.cpp runtime live here. **Nothing in this
directory is committed** — model files are large and are not ours to distribute.

The dev server picks the first `.gguf` file it finds alphabetically and launches
`llama-server` with it when you select *Local llama.cpp server* on the startup
screen.

## Adding a model

Either drop the file in here:

```bash
cp ~/Downloads/qwen2.5-1.5b-instruct-q4_k_m.gguf models/
```

or point at a file elsewhere, which is tidier for a large model:

```bash
export AILAND_LLAMA_MODEL=~/Downloads/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

Or scan a different directory entirely:

```bash
export AILAND_LLAMA_MODELS_DIR=~/models
```

## What to look for

An **instruct** model, quantised to `Q4_K_M` or `Q5_K_M`. A base (non-instruct)
model will not follow the NPC dialogue instructions at all.

Rough sizes, for calibration:

| Model | Q4_K_M | Q5_K_M |
| --- | --- | --- |
| Qwen2.5-1.5B-Instruct | ~1.1 GB | ~1.3 GB |
| Qwen2.5-3B-Instruct | ~1.8 GB | ~2.1 GB |
| Llama-3.2-3B-Instruct | ~2.0 GB | ~2.5 GB |

Larger models give noticeably better in-character dialogue; the runtime runs on
the CPU by default, so expect a longer pause before the first token. See
[`../docs/development.md`](../docs/development.md) for tuning.