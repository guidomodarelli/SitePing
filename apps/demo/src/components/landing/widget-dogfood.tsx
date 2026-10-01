"use client";

import { useEffect } from "react";

export function WidgetDogfood() {
  useEffect(() => {
    let destroyed = false;
    let instance: { destroy: () => void } | null = null;

    import("@beezping/widget").then(({ initBeezping }) => {
      if (destroyed) return;
      instance = initBeezping({
        endpoint: "/api/beezping",
        projectName: "landing",
        forceShow: true,
        accentColor: "#173CFF",
        locale: "en",
        position: "bottom-right",
        // "Open on page" links from /demo/inbox (?beezping=<id>) focus the annotation.
        deepLink: true,
      });
    });

    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, []);

  return null;
}
