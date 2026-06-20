import type { LanguageProvider } from "./types.js";
import { JavaProvider } from "./java.js";
import { PythonProvider } from "./python.js";
import { GoProvider } from "./go.js";
import { RustProvider } from "./rust.js";

const providers: LanguageProvider[] = [
  new JavaProvider(),
  new PythonProvider(),
  new GoProvider(),
  new RustProvider(),
];

export function getAllProviders(): LanguageProvider[] {
  return providers;
}

export function getProviderForExtension(ext: string): LanguageProvider | undefined {
  return providers.find((p) => p.language.extensions.includes(ext));
}

export function getProviderByName(name: string): LanguageProvider | undefined {
  return providers.find((p) => p.language.name === name);
}
