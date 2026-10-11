// Click-to-play YouTube: the page shows a thumbnail and only loads YouTube
// when someone presses play, so the service pages stay fast.
document.querySelectorAll("a.video[data-id]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const frame = document.createElement("iframe");
    frame.src = `https://www.youtube-nocookie.com/embed/${link.dataset.id}?autoplay=1&rel=0`;
    frame.title = link.getAttribute("aria-label") || "Video";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    link.replaceWith(frame);
  });
});
