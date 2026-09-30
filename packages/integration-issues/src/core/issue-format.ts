import type { FeedbackRecord } from "@siteping/core";
import {
  DIAGNOSTIC_ENTRIES_PER_KIND,
  DIAGNOSTIC_MESSAGE_MAX_LENGTH,
  EMBEDDABLE_SCREENSHOT_URL_PREFIX,
  EMPTY_DIAGNOSTICS_PLACEHOLDER,
  ISSUE_REFERENCE_MARKER,
  ISSUE_SECTION_HEADINGS,
  ISSUE_SECTION_SEPARATOR,
  ISSUE_TITLE_MAX_LENGTH,
  ISSUE_TITLE_PREFIX,
  TRUNCATION_SUFFIX,
} from "../constants/issue-format.js";

/** Title and Markdown body of an issue. */
export interface IssueContent {
  title: string;
  body: string;
}

export interface IssueFormatOptions {
  /** Applied to every free-text value copied from the feedback (message, author, URLs, viewport, screenshot URL, user agent, diagnostics). */
  redact: (text: string) => string;
  /** Query parameter of the widget's deep link, or `false` to omit the link. */
  deepLinkParam: string | false;
  /**
   * Absolute URL of the site, used to resolve relative page URLs (the widget
   * stores `window.location.pathname` by default) into the deep link. Without
   * it, feedbacks with a relative page URL get no deep link.
   */
  siteUrl?: string;
  /** Include the reviewer's email next to their name. Off by default: issues are often public. */
  includeAuthorEmail: boolean;
}

/** Identity of the feedback an issue belongs to, stored in the issue body. */
export interface IssueLink {
  feedbackId: string;
  projectName: string;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
    : value;
}

function section(heading: string, content: string): string {
  return `## ${heading}${ISSUE_SECTION_SEPARATOR}${content}`;
}

function buildDeepLink(feedback: FeedbackRecord, param: string, siteUrl: string | undefined): string | null {
  try {
    const url = new URL(feedback.url, siteUrl);
    url.searchParams.set(param, feedback.id);
    return url.toString();
  } catch {
    return null; // A relative page URL without `siteUrl` — nothing to link to.
  }
}

/** Screenshot section, or `null` when the (redacted) URL is not a public HTTPS URL GitHub can embed. */
function buildScreenshot(feedback: FeedbackRecord, redact: (text: string) => string): string | null {
  if (!feedback.screenshotUrl) return null;
  const screenshotUrl = redact(feedback.screenshotUrl);
  if (!screenshotUrl.startsWith(EMBEDDABLE_SCREENSHOT_URL_PREFIX)) return null;
  try {
    new URL(screenshotUrl);
  } catch {
    return null; // Redaction left something that is no longer a URL — do not embed it.
  }
  return section(ISSUE_SECTION_HEADINGS.screenshot, `![${ISSUE_SECTION_HEADINGS.screenshot}](${screenshotUrl})`);
}

function buildDiagnostics(feedback: FeedbackRecord, redact: (text: string) => string): string[] {
  if (!feedback.diagnostics) return [];
  const consoleLines = feedback.diagnostics.console
    .slice(0, DIAGNOSTIC_ENTRIES_PER_KIND)
    .map((entry) => `- ${entry.level}: ${truncate(redact(entry.message), DIAGNOSTIC_MESSAGE_MAX_LENGTH)}`);
  const networkLines = feedback.diagnostics.network
    .slice(0, DIAGNOSTIC_ENTRIES_PER_KIND)
    .map((entry) => `- ${entry.method} ${entry.status} ${redact(entry.url)} (${entry.durationMs}ms)`);
  return [
    section(ISSUE_SECTION_HEADINGS.consoleDiagnostics, consoleLines.join("\n") || EMPTY_DIAGNOSTICS_PLACEHOLDER),
    section(ISSUE_SECTION_HEADINGS.networkDiagnostics, networkLines.join("\n") || EMPTY_DIAGNOSTICS_PLACEHOLDER),
  ];
}

/** Default Markdown rendering — GitHub and GitLab render it. */
export function formatIssue(feedback: FeedbackRecord, options: IssueFormatOptions): IssueContent {
  const { redact } = options;
  const message = redact(feedback.message);
  const titleBudget = ISSUE_TITLE_MAX_LENGTH - ISSUE_TITLE_PREFIX.length - 1;
  const title = `${ISSUE_TITLE_PREFIX} ${truncate(message.replace(/\s+/g, " ").trim(), titleBudget)}`;

  const author = redact(
    options.includeAuthorEmail ? `${feedback.authorName} <${feedback.authorEmail}>` : feedback.authorName,
  );
  const deepLink =
    options.deepLinkParam === false ? null : buildDeepLink(feedback, options.deepLinkParam, options.siteUrl);
  const screenshot = buildScreenshot(feedback, redact);

  const sections = [
    section(ISSUE_SECTION_HEADINGS.message, message),
    section(ISSUE_SECTION_HEADINGS.type, feedback.type),
    section(ISSUE_SECTION_HEADINGS.pageUrl, redact(feedback.url)),
    deepLink ? section(ISSUE_SECTION_HEADINGS.deepLink, redact(deepLink)) : null,
    section(ISSUE_SECTION_HEADINGS.author, author),
    section(ISSUE_SECTION_HEADINGS.viewport, redact(feedback.viewport)),
    section(ISSUE_SECTION_HEADINGS.userAgent, redact(feedback.userAgent)),
    screenshot,
    ...buildDiagnostics(feedback, redact),
  ];
  return { title, body: sections.filter((part): part is string => part !== null).join(ISSUE_SECTION_SEPARATOR) };
}

/** Hidden marker appended to every issue body, linking it to its feedback. */
export function buildIssueMarker(link: IssueLink): string {
  return `${ISSUE_REFERENCE_MARKER.prefix}${toMarkerJson({ id: link.feedbackId, project: link.projectName })}${ISSUE_REFERENCE_MARKER.suffix}`;
}

/** JSON safe inside an HTML comment: `<` and `>` are escaped so a value cannot close the comment early. */
function toMarkerJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Substring identifying one feedback's issue — providers may use it to search server-side. */
export function feedbackMarkerFragment(feedbackId: string): string {
  return `"id":${toMarkerJson(feedbackId)}`;
}

/** Substring identifying every issue of a project. */
export function projectMarkerFragment(projectName: string): string {
  return `"project":${toMarkerJson(projectName)}`;
}

/**
 * The link stored in an issue body, or `null` when it has no (valid) marker.
 * Only the last marker counts: the genuine one is appended after the formatted
 * content, so an earlier one may come from user-controlled text.
 */
export function parseIssueMarker(body: string): IssueLink | null {
  const markerJson = Array.from(body.matchAll(ISSUE_REFERENCE_MARKER.pattern)).at(-1)?.[1];
  if (!markerJson) return null;
  try {
    const parsed: unknown = JSON.parse(markerJson);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { id, project } = parsed as { id?: unknown; project?: unknown };
    return typeof id === "string" && typeof project === "string" ? { feedbackId: id, projectName: project } : null;
  } catch {
    return null; // A tampered or truncated marker is treated as absent.
  }
}
