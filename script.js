/* Scroll reveal — IntersectionObserver with reduced-motion fallback */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveals = document.querySelectorAll(".reveal");

  if (!reveals.length) {
    return;
  }

  function revealAll() {
    reveals.forEach((el) => el.classList.add("is-visible"));
  }

  if (reduce || !("IntersectionObserver" in window)) {
    revealAll();
    return;
  }

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
      rootMargin: "0px 0px -32px 0px",
    }
  );

  reveals.forEach(function (el) {
    observer.observe(el);
  });
})();
