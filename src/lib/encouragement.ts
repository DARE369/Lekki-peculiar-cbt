/**
 * Warm messages for the screen a student sees after submitting when results are not shown.
 * None of them mention how the student did: they are about effort, and about getting ready for the next paper.
 */
const MESSAGES = [
  "You gave it your best, and that is what counts. Take a breath, you've earned it.",
  "Finishing an exam takes focus and courage. Be proud of yourself today.",
  "Every paper you sit makes the next one easier. Keep it up!",
  "Well done for staying calm and seeing it through. Rest well, then get ready for the next one.",
  "Hard work shows. Keep learning, keep asking questions, and your next paper will feel even better.",
  "You showed up and did the work. That is how great students are made.",
  "One paper down! Drink some water, rest your mind, and look forward to the next challenge.",
  "Learning never stops. Today you gave your effort, and tomorrow you can build on it.",
];

/** The same student and attempt always get the same message, so it doesn't change when the screen redraws. */
export function encouragementFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MESSAGES[h % MESSAGES.length];
}
