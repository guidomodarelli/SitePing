// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Beezping site URLs", () => {
  it("uses the local demo origin when no deployed origin is configured", async () => {
    vi.stubEnv("BEEZPING_SITE_URL", "");
    vi.resetModules();
    const { absoluteUrl, languageAlternates } = await import("../src/lib/docs/urls");

    expect(absoluteUrl("/docs/quickstart", "en")).toBe("http://localhost:3000/docs/quickstart");
    expect(absoluteUrl("/docs/quickstart", "fr")).toBe("http://localhost:3000/fr/docs/quickstart");
    expect(languageAlternates("/docs")["x-default"]).toBe("http://localhost:3000/docs");
  });

  it("uses the configured deployment origin for localized documentation and robots", async () => {
    vi.stubEnv("BEEZPING_SITE_URL", "https://demo.example.com/");
    vi.resetModules();
    const { absoluteUrl, languageAlternates } = await import("../src/lib/docs/urls");
    const { default: robots } = await import("../src/app/robots");

    expect(absoluteUrl("/docs", "fr")).toBe("https://demo.example.com/fr/docs");
    expect(languageAlternates("/docs").en).toBe("https://demo.example.com/docs");
    expect(robots().sitemap).toBe("https://demo.example.com/sitemap.xml");
  });
});
