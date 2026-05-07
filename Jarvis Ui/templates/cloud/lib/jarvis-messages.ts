import catalog from "../../../../src/shared/jarvis-messages.json";

type Language = "ko" | "en";

function getPathValue(target: unknown, key = ""): unknown {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
        return (current as Record<string, unknown>)[part];
      }
      return undefined;
    }, target);
}

function interpolate(template: string, params: Record<string, unknown> = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ""));
}

export function getJarvisLanguage(explicit?: string | null): Language {
  if (String(explicit || "").toLowerCase().startsWith("ko")) {
    return "ko";
  }
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko")) {
    return "ko";
  }
  return "en";
}

export function jarvisMessage(language: string | null | undefined, key: string, params: Record<string, unknown> = {}) {
  const lang = getJarvisLanguage(language);
  const localized = getPathValue((catalog as Record<string, unknown>)[lang], key);
  const fallback = getPathValue((catalog as Record<string, unknown>).en, key);
  const resolved = localized ?? fallback;

  if (Array.isArray(resolved)) {
    return resolved.map((entry) => interpolate(String(entry || ""), params));
  }

  return interpolate(String(resolved ?? key), params);
}

export function jarvisText(language: string | null | undefined, key: string, params: Record<string, unknown> = {}) {
  const value = jarvisMessage(language, key, params);
  return Array.isArray(value) ? value.join(" ") : value;
}
