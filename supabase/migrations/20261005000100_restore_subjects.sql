-- Subjects were being retired by accidental single taps on the Classes & subjects page.
-- Bring every subject back; the page now asks before retiring and has Restore buttons.
update public.subjects set active = true where active = false;
