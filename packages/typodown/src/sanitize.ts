// HTML sanitization for the raw-HTML render sinks.
//
// The editor renders raw HTML found in the markdown (inline/block HTML widgets
// and table cells) as live DOM via innerHTML, like Typora. That HTML can come
// from an untrusted file (a downloaded note, a shared vault), so it must be
// sanitized before it hits the DOM or it is a stored-XSS vector: <script>,
// event-handler attributes (onerror/onclick/...), and javascript:/data: URIs
// all execute otherwise. DOMPurify strips exactly those while leaving the safe
// structural/formatting HTML we do want to render.

import DOMPurify from "dompurify";

// USE_PROFILES keeps HTML (and lets SVG/MathML through for KaTeX-style content)
// while DOMPurify's defaults already remove <script>, event handlers, and
// dangerous URI schemes. We additionally allow target/rel on anchors so links
// keep opening in a new tab.
const CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ADD_ATTR: ["target", "rel"],
};

/** Sanitize an HTML string for insertion via innerHTML. Returns a string with
 * scripts, event handlers, and dangerous URIs removed. */
export function sanitizeHtml(html: string, resolveImageSrc?: (src: string) => string): string {
  const sanitized = DOMPurify.sanitize(html, CONFIG) as string;
  if (!resolveImageSrc) return sanitized;

  const template = document.createElement("template");
  template.innerHTML = sanitized;
  for (const image of template.content.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src");
    if (src === null) continue;
    try {
      image.setAttribute("src", resolveImageSrc(src));
    } catch {
      // A host resolver should not make otherwise valid HTML fail to render.
    }
  }
  // Sanitize again because the host callback supplied the replacement URI.
  return DOMPurify.sanitize(template.innerHTML, CONFIG) as string;
}
