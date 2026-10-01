/** Generates the Next.js API route with an injected Prisma client. */
export const ROUTE_TEMPLATE = `import { createBeezpingHandler } from "@beezping/adapter-prisma";
import { prisma } from "@/lib/prisma";

export const { GET, POST, PATCH, DELETE, OPTIONS } = createBeezpingHandler({
  prisma,
  // Required in production — the handler refuses to start without a key.
  // Status changes and deletes then need \`Authorization: Bearer <key>\`;
  // feedback submissions from the widget stay open.
  apiKey: process.env.BEEZPING_API_KEY,
  // allowedOrigins: ["https://your-site.com"],
});
`;
