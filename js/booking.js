// Sizes the embedded nxsportal form to its real content height.
//
// nxsportal posts to its parent window whenever the form's content changes:
//   { type: "nexus-form-resize", embedId: <string>, height: <number, px> }
// The embedId must match the `embedResize` query param on the iframe src.

const FORM_ORIGIN = "https://nxsportal.com";
const EMBED_ID = "nexus-form-booking";
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 50000;
// A drop this large means the form was replaced by its confirmation state;
// the user is likely scrolled past it, so bring the top back into view.
const COLLAPSE_THRESHOLD = 600;

// If nxsportal never reports in, reveal the frame anyway rather than leave a
// visitor staring at "Loading form…" forever.
const REVEAL_TIMEOUT_MS = 6000;

const frame = document.getElementById("form");

function reveal() {
  frame.classList.add("is-live");
}

function applyHeight(height) {
  const px = Math.ceil(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
  frame.style.height = `${px}px`;
  frame.setAttribute("height", String(px));
  reveal();
}

setTimeout(reveal, REVEAL_TIMEOUT_MS);

function scrollFrameIntoView() {
  const barHeight = document.querySelector(".bar")?.offsetHeight ?? 0;
  const top = frame.getBoundingClientRect().top + window.scrollY - barHeight - 8;
  if (window.scrollY > top) {
    window.scrollTo({ top, behavior: "smooth" });
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== FORM_ORIGIN) return;
  if (event.source !== frame.contentWindow) return;

  const data = event.data;
  if (!data || data.type !== "nexus-form-resize" || data.embedId !== EMBED_ID) return;
  if (typeof data.height !== "number" || !Number.isFinite(data.height)) return;

  const previous = frame.getBoundingClientRect().height;
  applyHeight(data.height);
  if (previous - data.height > COLLAPSE_THRESHOLD) {
    scrollFrameIntoView();
  }
});
