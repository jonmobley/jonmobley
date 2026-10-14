// PostHog product analytics: counts visits and page views only.
// No cookies or browser storage (persistence "memory"), no user identification, no session recording.
// Runs only on the real live site and never throws, so it can't break a page.
(function () {
  try {
    var host = location.hostname.toLowerCase();
    if (navigator.webdriver) return;
    if (host !== "jonmobley.com" && host !== "www.jonmobley.com") return;
    // Standard PostHog snippet
    !(function (t, e) {
      var o, n, p, r;
      e.__SV ||
        ((window.posthog = e),
        (e._i = []),
        (e.init = function (i, s, a) {
          function g(t, e) {
            var o = e.split(".");
            2 == o.length && ((t = t[o[0]]), (e = o[1])),
              (t[e] = function () {
                t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
              });
          }
          ((p = t.createElement("script")).type = "text/javascript"),
            (p.crossOrigin = "anonymous"),
            (p.async = !0),
            (p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js"),
            (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r);
          var u = e;
          for (
            void 0 !== a ? (u = e[a] = []) : (a = "posthog"),
              u.people = u.people || [],
              u.toString = function (t) {
                var e = "posthog";
                return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e;
              },
              u.people.toString = function () {
                return u.toString(1) + ".people (stub)";
              },
              o = "init capture register register_once unregister identify reset opt_out_capturing opt_in_capturing".split(" "),
              n = 0;
            n < o.length;
            n++
          )
            g(u, o[n]);
          e._i.push([i, s, a]);
        }),
        (e.__SV = 1));
    })(document, window.posthog || []);
    // Hide ids/tokens: drop query strings and #fragments, and replace long id-like path segments.
    var idSeg = function (s) { return s.length >= 16 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s) ? ":id" : s; };
    var cleanPath = function (p) { return p.split("/").map(idSeg).join("/"); };
    var strip = function (u) {
      try { var x = new URL(u); return x.origin + cleanPath(x.pathname); } catch (e) { return typeof u === "string" ? cleanPath(u.split(/[?#]/)[0]) : u; }
    };
    var fix = function (bag) {
      if (!bag) return;
      Object.keys(bag).forEach(function (k) {
        var v = bag[k];
        if (typeof v !== "string") return;
        if ((/url|referrer/i.test(k) && v.indexOf("://") >= 0) || /pathname/i.test(k)) bag[k] = strip(v);
      });
    };
    posthog.init("phc_ygY8gp5pNpDmfL9gCqL3BLegG9uwV7ZsyD4Gg77vqfaw", {
      api_host: "https://us.i.posthog.com",
      persistence: "memory",
      person_profiles: "identified_only",
      disable_session_recording: true,
      capture_pageview: true,
      autocapture: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_surveys: true,
      mask_all_element_attributes: true,
      mask_all_text: true,
      before_send: function (event) {
        if (!event) return event;
        fix(event.properties);
        fix(event.$set);
        fix(event.$set_once);
        if (event.properties) { delete event.properties.title; delete event.properties.$title; }
        return event;
      },
    });
    posthog.register({ app: "jonmobley" });
  } catch (e) {}
})();
