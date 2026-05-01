/**
 * UI controller — owns the DOM, drives the pipeline, renders results.
 *
 * Pipeline orchestration:
 *   1. User drops a file.
 *   2. Stage 1 (analyze) runs unconditionally — pure JS, fast.
 *   3. Stage 2a (VLM) runs only if the user has provided an API key.
 *   4. Stage 2b (tagger) runs in the background if enabled in settings.
 *   5. Stage 3 (fuse) runs once 1 + (2a or 2b or both) complete.
 *   6. Stage 4 (synthesize) renders all six prompts.
 *
 * Stages 2a / 2b can fail independently — fusion is defensive.
 */

import type { FusedSchema, SynthesizedPrompt, TargetModel, VlmReport, TaggerReport } from "@/types/schema";
import { analyze } from "@/pipeline/analyze";
import { runVlm, VlmError, type ProviderConfig } from "@/pipeline/vlm";
import { runTagger, TaggerError } from "@/pipeline/tagger";
import { fuse } from "@/pipeline/fusion";
import { synthesizeAll } from "@/pipeline/synthesize";
import { el, paletteSwatch, statRow, copyButton } from "./components";

const STORAGE_KEY = "imex.config.v1";

interface PersistedConfig {
  vlmProvider?: ProviderConfig["id"];
  vlmKey?: string;
  taggerEnabled?: boolean;
}

function loadConfig(): PersistedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedConfig) : {};
  } catch {
    return {};
  }
}

function saveConfig(c: PersistedConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

/* --------------------------------------------------------------------------
 * Mount
 * -------------------------------------------------------------------------- */

export function mount(root: HTMLElement): void {
  let config = loadConfig();
  let currentFile: File | null = null;
  let currentSchema: FusedSchema | null = null;
  let currentPrompts: ReadonlyArray<SynthesizedPrompt> = [];
  let activeModel: TargetModel = "midjourney";
  let busy = false;

  const ui = build();
  root.replaceChildren(ui);

  function build(): HTMLElement {
    const wrap = el("div", { class: "min-h-screen flex flex-col" });
    wrap.append(header(), main(), footer());
    return wrap;
  }

  function header(): HTMLElement {
    return el(
      "header",
      { class: "mx-auto w-full max-w-7xl px-6 pt-8 pb-4 flex items-center justify-between" },
      el(
        "div",
        { class: "flex items-center gap-3" },
        el(
          "div",
          {
            class:
              "h-9 w-9 rounded-md bg-signal-500/15 border border-signal-400/40 grid place-items-center text-signal-400 font-mono text-sm font-bold",
          },
          "ix"
        ),
        el(
          "div",
          { class: "leading-tight" },
          el(
            "div",
            { class: "font-mono text-[11px] uppercase tracking-[0.3em] text-ink-300" },
            "imex"
          ),
          el(
            "div",
            { class: "font-display text-lg font-semibold text-ink-100" },
            "IMG → PROMPT // pipeline"
          )
        )
      ),
      el(
        "div",
        { class: "hidden md:flex items-center gap-2 text-xs font-mono text-ink-300" },
        el("span", { class: "h-2 w-2 rounded-full bg-signal-400" }),
        document.createTextNode("CLIENT-SIDE · BYO KEY · NO TELEMETRY")
      )
    );
  }

  function main(): HTMLElement {
    const grid = el("main", {
      class: "mx-auto w-full max-w-7xl px-6 pb-12 grid gap-6 lg:grid-cols-[380px_1fr]",
    });
    grid.append(left(), right());
    return grid;
  }

  function left(): HTMLElement {
    const col = el("div", { class: "space-y-5" });

    /* ----- Drop zone ----- */
    const drop = el("section", { class: "panel" });
    drop.append(el("div", { class: "panel-header" }, el("span", {}, "Source image")));
    const body = el("div", { class: "panel-body space-y-4" });
    const zone = el("label", {
      class:
        "flex h-44 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-ink-500/60 bg-ink-900/40 text-center text-sm text-ink-300 hover:border-signal-400 transition",
    });
    const file = el("input", {
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      class: "hidden",
    }) as HTMLInputElement;
    const zoneText = el(
      "div",
      {},
      el("div", { class: "font-mono text-[11px] uppercase tracking-widest" }, "drop / click to upload"),
      el("div", { class: "mt-1 text-ink-300" }, "PNG · JPEG · WebP — never leaves your machine")
    );
    zone.append(file, zoneText);

    file.addEventListener("change", () => {
      const f = file.files?.[0] ?? null;
      if (f) void runPipeline(f);
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("border-signal-400");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("border-signal-400"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("border-signal-400");
      const f = e.dataTransfer?.files?.[0];
      if (f) void runPipeline(f);
    });

    body.append(zone);
    drop.append(body);

    /* ----- Settings ----- */
    const settings = el("section", { class: "panel" });
    settings.append(el("div", { class: "panel-header" }, el("span", {}, "Frontier VLM")));
    const sBody = el("div", { class: "panel-body space-y-3" });
    const provider = el("select", { class: "field" }) as HTMLSelectElement;
    for (const opt of [
      { v: "openai", l: "OpenAI · gpt-4o-mini" },
      { v: "anthropic", l: "Anthropic · claude-3-5-sonnet" },
      { v: "google", l: "Google · gemini-1.5-flash" },
    ]) {
      const o = document.createElement("option");
      o.value = opt.v;
      o.textContent = opt.l;
      provider.append(o);
    }
    if (config.vlmProvider) provider.value = config.vlmProvider;
    provider.addEventListener("change", () => {
      config = { ...config, vlmProvider: provider.value as ProviderConfig["id"] };
      saveConfig(config);
    });

    const key = el("input", {
      type: "password",
      class: "field font-mono",
      placeholder: "sk-… (kept in localStorage, sent only to your provider)",
    }) as HTMLInputElement;
    key.value = config.vlmKey ?? "";
    key.addEventListener("change", () => {
      config = { ...config, vlmKey: key.value };
      saveConfig(config);
    });

    const taggerToggle = el("label", { class: "flex items-center gap-2 text-sm text-ink-200" });
    const tcb = el("input", { type: "checkbox", class: "accent-signal-400" }) as HTMLInputElement;
    tcb.checked = config.taggerEnabled ?? false;
    tcb.addEventListener("change", () => {
      config = { ...config, taggerEnabled: tcb.checked };
      saveConfig(config);
    });
    taggerToggle.append(
      tcb,
      document.createTextNode("Run local SigLIP tagger (free, ~80MB)")
    );

    sBody.append(
      el("label", { class: "label" }, "Provider"),
      provider,
      el("label", { class: "label mt-2" }, "API key"),
      key,
      taggerToggle
    );
    settings.append(sBody);

    col.append(drop, settings);
    return col;
  }

  function right(): HTMLElement {
    const col = el("div", { class: "space-y-5", "data-results": "" });
    if (!currentSchema) {
      const empty = el("section", { class: "panel" });
      empty.append(el("div", { class: "panel-header" }, el("span", {}, "Awaiting input")));
      empty.append(
        el(
          "div",
          { class: "panel-body text-sm text-ink-300" },
          "Drop an image on the left. Stage 1 (deterministic) runs immediately. Stage 2 (VLM / tagger) runs if configured."
        )
      );
      col.append(empty);
      return col;
    }

    col.append(schemaPanel(currentSchema), promptsPanel(currentPrompts, activeModel, (m) => {
      activeModel = m;
      rerenderRight();
    }));
    return col;
  }

  function rerenderRight(): void {
    const old = root.querySelector<HTMLElement>("[data-results]");
    if (old) old.replaceWith(right());
  }

  /* ----- Result panels ----- */

  function schemaPanel(s: FusedSchema): HTMLElement {
    const panel = el("section", { class: "panel" });
    panel.append(
      el(
        "div",
        { class: "panel-header" },
        el("span", {}, "Fused Schema"),
        el(
          "span",
          { class: "text-ink-300 normal-case tracking-normal text-[10px] font-mono" },
          s.aiFingerprint.detected
            ? `${s.aiFingerprint.generator} fingerprint detected`
            : "no AI fingerprint"
        )
      )
    );
    const body = el("div", { class: "panel-body grid gap-4 md:grid-cols-2" });

    body.append(
      statRow("Subject", s.subject.value, s.subject.confidence),
      statRow("Style", s.style.value, s.style.confidence),
      statRow("Linework", s.linework.value, s.linework.confidence),
      statRow("Medium", s.medium.value, s.medium.confidence),
      statRow("Lighting", s.lighting.value, s.lighting.confidence),
      statRow("Mood", s.mood.value, s.mood.confidence),
      statRow("Composition", s.composition.value, s.composition.confidence),
      statRow("Aspect ratio", s.aspectRatio, 1.0)
    );

    const palette = el(
      "div",
      { class: "md:col-span-2" },
      el("div", { class: "label" }, "Palette"),
      el(
        "div",
        { class: "flex flex-wrap gap-2" },
        ...s.palette.map((p) => paletteSwatch(p))
      )
    );
    body.append(palette);

    if (s.negatives.length) {
      body.append(
        el(
          "div",
          { class: "md:col-span-2" },
          el("div", { class: "label" }, "Negatives"),
          el(
            "div",
            { class: "flex flex-wrap gap-1.5" },
            ...s.negatives.map((n) => el("span", { class: "pill" }, n))
          )
        )
      );
    }

    panel.append(body);
    return panel;
  }

  function promptsPanel(
    prompts: ReadonlyArray<SynthesizedPrompt>,
    active: TargetModel,
    onPick: (m: TargetModel) => void
  ): HTMLElement {
    const panel = el("section", { class: "panel" });
    panel.append(el("div", { class: "panel-header" }, el("span", {}, "Synthesized Prompts")));
    const body = el("div", { class: "panel-body space-y-4" });

    const tabs = el("div", { class: "flex flex-wrap gap-2" });
    for (const p of prompts) {
      const isActive = p.model === active;
      const t = el(
        "button",
        {
          type: "button",
          class: isActive
            ? "rounded-md border border-signal-400 bg-signal-500/10 px-3 py-1.5 text-xs font-mono text-signal-400"
            : "rounded-md border border-ink-500/60 bg-ink-700/40 px-3 py-1.5 text-xs font-mono text-ink-200 hover:border-signal-400/50",
        },
        p.model
      );
      t.addEventListener("click", () => onPick(p.model));
      tabs.append(t);
    }

    const current = prompts.find((p) => p.model === active) ?? prompts[0];
    const code = el(
      "pre",
      {
        class:
          "whitespace-pre-wrap break-words rounded-lg border border-ink-600/70 bg-ink-900/80 p-4 font-mono text-[13px] leading-relaxed text-signal-400",
      },
      current?.text ?? ""
    );

    const actions = el(
      "div",
      { class: "flex items-center justify-between" },
      el(
        "div",
        { class: "text-[11px] font-mono text-ink-300" },
        `${current?.tokenEstimate ?? 0} tok · ${current?.model ?? "—"}`
      ),
      copyButton(current?.text ?? "")
    );

    body.append(tabs, code, actions);
    panel.append(body);
    return panel;
  }

  /* ----- Pipeline orchestration ----- */

  async function runPipeline(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    currentFile = file;
    setStatus(`Analyzing ${file.name}…`);

    try {
      const deterministic = await analyze(file);
      setStatus("Stage 1 done. Querying VLM / tagger…");

      const vlmPromise: Promise<VlmReport | undefined> =
        config.vlmKey && config.vlmProvider
          ? runVlm(file, deterministic, {
              id: config.vlmProvider,
              apiKey: config.vlmKey,
            }).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn("VLM failed:", msg);
              void VlmError;
              return undefined;
            })
          : Promise.resolve(undefined);

      const taggerPromise: Promise<TaggerReport | undefined> = config.taggerEnabled
        ? runTagger(file).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("Tagger failed:", msg);
            void TaggerError;
            return undefined;
          })
        : Promise.resolve(undefined);

      const [vlm, tagger] = await Promise.all([vlmPromise, taggerPromise]);

      currentSchema = fuse({
        deterministic,
        ...(vlm ? { vlm } : {}),
        ...(tagger ? { tagger } : {}),
      });
      currentPrompts = synthesizeAll(currentSchema);
      setStatus("");
      rerenderRight();
    } catch (e) {
      console.error(e);
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy = false;
      void currentFile;
    }
  }

  function setStatus(msg: string): void {
    const existing = root.querySelector<HTMLElement>("[data-status]");
    const bar: HTMLElement =
      existing ??
      (() => {
        const created = el("div", {
          "data-status": "",
          class:
            "fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink-800 border border-ink-500/60 px-4 py-2 text-xs font-mono text-ink-100 shadow-glow transition",
        });
        root.append(created);
        return created;
      })();
    bar.textContent = msg;
    bar.style.opacity = msg ? "1" : "0";
  }

  function footer(): HTMLElement {
    return el(
      "footer",
      {
        class: "mt-auto border-t border-ink-600/60 py-6 text-center text-xs font-mono text-ink-300",
      },
      "imex · client-side · open source · ",
      el(
        "a",
        {
          href: "https://github.com/macchant/imex",
          target: "_blank",
          rel: "noopener",
          class: "underline hover:text-signal-400",
        },
        "source ↗"
      )
    );
  }
}
