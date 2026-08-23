const frame = document.querySelector(".video-frame");
const play = document.querySelector(".play");

if (frame && play) {
  play.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src =
      "https://www.youtube.com/embed/Dt7bwLbH3Qw?autoplay=1&rel=0&modestbranding=1";
    iframe.title = "Jon Mobley at Chicago Magic Lounge";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    frame.appendChild(iframe);
    play.remove();
  });
}
