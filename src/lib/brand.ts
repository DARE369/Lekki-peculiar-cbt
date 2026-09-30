// Everything school-specific about the look and wording lives here.
// Colours are defined as CSS variables in src/app/globals.css (search "BRAND").
export const brand = {
  schoolName: "Lekki Peculiar School",
  shortName: "Lekki Peculiar",
  productName: "Peculiar CBT",
  website: "https://peculiarschools.com",
  /** Shown on the landing and sign-in pages. */
  vision: "Imparting intellectual, leadership and moral values in a perfectly conducive atmosphere.",
  coreValues: ["Creativity", "Culture", "Cleanliness", "Care", "Christ"],
  /**
   * Put the school's crest in /public (e.g. /public/brand/crest.png) and set its path here.
   * Until then a monogram mark is drawn in the brand colours.
   */
  logoSrc: null as string | null,
};
