/**
 * Tiny DOM helpers used across the UI. No framework — keeps the bundle small
 * and the surface area easy to read.
 */

import type { PaletteColor } from "@/types/schema";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function paletteSwatch(p: PaletteColor): HTMLElement {
  const wrap = el("div", { class: "flex items-center gap-1.5" });
  const swatch = el("div", {
    class: "h-6 w-6 rounded border border-ink-500/60",
    style: `background:${p.hex}`,
    title: `${p.hex} · ${(p.weight * 100).toFixed(0)}%`,
  });
  wrap.append(
    swatch,
    el(
      "span",
      { class: "font-mono text-[11px] text-ink-200" },
      `${p.hex.toUpperCase()} · ${(p.weight * 100).toFixed(0)}%`
    )
  );
  return wrap;
}

export function statRow(label: string, value: string, confidence: number): HTMLElement {
  const wrap = el("div", { class: "min-w-0" });
  wrap.append(
    el(
      "div",
      { class: "flex items-baseline justify-between gap-2" },
      el("span", { class: "label !mb-0" }, label),
      el(
        "span",
        { class: "font-mono text-[10px] text-ink-300" },
        `${(confidence * 100).toFixed(0)}%`
      )
    ),
    el(
      "div",
      { class: "truncate text-sm text-ink-100", title: value },
      value
    ),
    el(
      "div",
      { class: "mt-1 h-1 rounded-full bg-ink-700/80 overflow-hidden" },
      el("div", {
        class: "h-full bg-signal-400",
        style: `width:${(confidence * 100).toFixed(0)}%`,
      })
    )
  );
  return wrap;
}

export function copyButton(text: string): HTMLButtonElement {
  const btn = el("button", { type: "button", class: "btn-primary" }, "Copy") as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = "Copied ✓";
    setTimeout(() => {
      btn.textContent = original;
    }, 1200);
  });
  return btn;
}
