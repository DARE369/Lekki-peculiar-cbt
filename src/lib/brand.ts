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
  /** Emblem without the wording, for small places (sidebar, headers). Set to null to draw a monogram instead. */
  logoSrc: "/brand/emblem.png" as string | null,
  /** Full logo with the school name and motto (sign-in page, emails). */
  fullLogoSrc: "/brand/crest.png",
};
