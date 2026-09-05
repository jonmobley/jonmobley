const desktop = window.matchMedia("(min-width: 701px)");

function loadWistia() {
  if (document.querySelector('script[src*="fast.wistia.com/assets"]')) return;

  const swatch = document.querySelector(".wistia_swatch");
  if (swatch && !swatch.querySelector("img")) {
    const img = document.createElement("img");
    img.src = "https://fast.wistia.com/embed/medias/oekwxe0zlu/swatch";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.onload = () => {
      swatch.style.opacity = "1";
    };
    swatch.append(img);
  }

  const jsonp = document.createElement("script");
  jsonp.src = "https://fast.wistia.com/embed/medias/oekwxe0zlu.jsonp";
  jsonp.async = true;
  const player = document.createElement("script");
  player.src = "https://fast.wistia.com/assets/external/E-v1.js";
  player.async = true;
  document.head.append(jsonp, player);
}

if (desktop.matches) loadWistia();
desktop.addEventListener("change", (event) => {
  if (event.matches) loadWistia();
});

const frame = document.querySelector(".video-frame");
const play = document.querySelector(".play");

if (frame && play) {
  play.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src =
      "https://www.youtube-nocookie.com/embed/Dt7bwLbH3Qw?autoplay=1&rel=0&modestbranding=1";
    iframe.title = "Jon Mobley at Chicago Magic Lounge";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    frame.appendChild(iframe);
    play.remove();
  });
}
